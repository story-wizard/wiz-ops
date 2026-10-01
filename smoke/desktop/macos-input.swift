import Cocoa
import ApplicationServices
import ScreenCaptureKit
import ImageIO
import UniformTypeIdentifiers

// Resolve the Unix process on every invocation. NSRunningApplication is diagnostic only.
struct InputError: Error { let message: String }
func require(_ condition: Bool, _ message: String) throws { if !condition { throw InputError(message: message) } }
func ps(_ arguments: [String]) throws -> String {
    let process = Process(), pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps"); process.arguments = arguments
    process.standardOutput = pipe; process.standardError = FileHandle.nullDevice
    try process.run(); let data = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
    try require(process.terminationStatus == 0, "Unable to inspect the selected Unix process")
    return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?; return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func frame(_ element: AXUIElement) -> CGRect? {
    guard let p = attribute(element, kAXPositionAttribute), let s = attribute(element, kAXSizeAttribute), CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var position = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &position), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: position, size: size)
}
func rectangle(_ value: CGRect) -> [String: Double] { ["x":value.minX,"y":value.minY,"width":value.width,"height":value.height] }
func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func actions(_ element: AXUIElement) -> [String] { var names: CFArray?; AXUIElementCopyActionNames(element, &names); return names as? [String] ?? [] }
let keyCodes: [String:CGKeyCode] = ["escape":53,"return":36,"tab":48,"space":49,"delete":51,"k":40,"n":45,"s":1,"a":0,"z":6,"d":2,"c":8,"v":9]
func emit(_ value: [String: Any]) { if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) { FileHandle.standardOutput.write(data); print() } }

@main struct NativeInput {
    static func main() async {
        var dispatched = false
        do {
            let args = CommandLine.arguments
            try require(args.count == 5 && args[1] == "--executable" && args[3] == "--request", "Use --executable PATH --request JSON_FILE")
            let executable = URL(fileURLWithPath: args[2]).resolvingSymlinksInPath().path
            try require(executable.hasPrefix("/") && [".app/Contents/MacOS/wizard-bin",".app/Contents/MacOS/wizard"].contains(where:executable.hasSuffix), "Select the exact packaged Wizard executable")
            let data = try Data(contentsOf: URL(fileURLWithPath: args[4])); try require(data.count <= 131072, "Input request exceeds the size limit")
            guard let request = try JSONSerialization.jsonObject(with: data) as? [String: Any], let command = request["command"] as? String else { throw InputError(message: "Supply a JSON command") }
            let permitted = ["inspect","screenshot","action","set-value","click","drag","key"]
            try require(permitted.contains(command), "Unsupported native input command")
            let matches = try ps(["-axo","pid=,comm="]).split(separator: "\n").compactMap { line -> pid_t? in
                let fields = line.trimmingCharacters(in: .whitespaces).split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
                guard fields.count == 2, String(fields[1]).trimmingCharacters(in: .whitespaces) == executable else { return nil }
                return pid_t(fields[0])
            }
            try require(matches.count == 1, "Expected exactly one running process for the selected executable")
            let pid = matches[0], started = try ps(["-p",String(pid),"-o","lstart="])
            if command != "inspect" { try require(request["pid"] as? Int32 == pid && request["started"] as? String == started,"Supply the PID and start time from a fresh inspection; process identity changed or is absent") }
            func verifyOwner() throws {
                try require(try ps(["-p",String(pid),"-o","comm="]) == executable && ps(["-p",String(pid),"-o","lstart="]) == started, "The selected process exited or its identity changed")
            }
            let windowServer=request["mode"] as? String == "window-server"
            if windowServer { try require(["inspect","screenshot","click","drag","key"].contains(command),"WindowServer mode supports observations and physical input only") }
            else { try require(AXIsProcessTrusted(), "Native accessibility permission is unavailable; no permission changes were attempted") }
            let app = AXUIElementCreateApplication(pid)
            let windows=windowServer ? [] : attribute(app,kAXWindowsAttribute) as? [AXUIElement] ?? []
            try require(windowServer || !windows.isEmpty,"The verified PID did not expose AXWindows")
            func topWindow(_ at: CGPoint? = nil) -> [String:Any]? {
                let entries=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
                return entries.first { entry in
                    guard (at != nil || (entry[kCGWindowLayer as String] as? NSNumber)?.intValue==0), (entry[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1 > 0,let b=entry[kCGWindowBounds as String] as? [String:Any],let r=CGRect(dictionaryRepresentation:b as CFDictionary) else { return false }
                    return at.map(r.contains) ?? true
                }
            }
            func foreground() -> Bool { windowServer ? (topWindow()?[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid : attribute(app,kAXFrontmostAttribute) as? Bool == true }
            let inventory = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
            let owned = inventory.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid }
            var elements: [(AXUIElement,[Int])] = [], rows: [[String:Any]] = []
            let depth = request["depth"] as? Int ?? (["inspect","action","set-value"].contains(command) ? 10 : 0), limit = request["limit"] as? Int ?? 1000
            try require(depth >= 0 && depth <= 30 && limit >= 1 && limit <= 5000, "Invalid inspection bounds")
            func walk(_ element: AXUIElement, _ path: [Int], _ level: Int) {
                if elements.count >= limit || level > depth { return }; elements.append((element,path))
                let role = attribute(element,kAXRoleAttribute) as? String ?? ""
                var row: [String:Any] = ["path":path,"role":role,"title":attribute(element,kAXTitleAttribute) as? String ?? "","identifier":attribute(element,kAXIdentifierAttribute) as? String ?? "","actions":actions(element)]
                if let bounds = frame(element) { row["frame"] = rectangle(bounds) }
                if role != "AXSecureTextField", let value = attribute(element,kAXValueAttribute) { if CFGetTypeID(value) == CFStringGetTypeID() { row["value"] = value as! String } else if CFGetTypeID(value) == CFNumberGetTypeID() || CFGetTypeID(value) == CFBooleanGetTypeID() { row["value"] = value as! NSNumber } }
                rows.append(row); if level < depth { for (index,child) in children(element).enumerated() { walk(child,path+[index],level+1) } }
            }
            for (index,window) in windows.enumerated() { walk(window,[index],0) }
            var result: [String:Any] = ["id":UUID().uuidString,"pid":pid,"started":started,"executable":executable,"command":command,"driver":"macos-verified-pid","status":"Observed","inspection":windowServer ? "window-server" : "accessibility"]
            if command == "inspect" {
                result["elements"] = rows; result["truncated"] = elements.count >= limit
                result["windows"] = owned.compactMap { entry -> [String:Any]? in
                    guard let bounds = entry[kCGWindowBounds as String] as? [String:Any], let rectangle = CGRect(dictionaryRepresentation: bounds as CFDictionary), let number = entry[kCGWindowNumber as String] else { return nil }
                    return ["window":number,"title":entry[kCGWindowName as String] as? String ?? "","frame":selfRectangle(rectangle)]
                }
                result["launchServicesPids"] = NSWorkspace.shared.runningApplications.filter { $0.bundleURL?.path == URL(fileURLWithPath: executable).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().path }.map { Int($0.processIdentifier) }
            } else if command == "action" || command == "set-value" {
                var selected: AXUIElement?
                if let path = request["path"] as? [Int] { selected = elements.first { $0.1 == path }?.0 }
                else if let identifier = request["identifier"] as? String, !identifier.isEmpty { let candidates = elements.filter { attribute($0.0,kAXIdentifierAttribute) as? String == identifier }; try require(candidates.count == 1,"Accessibility identifier is absent or ambiguous"); selected = candidates[0].0 }
                guard let element = selected else { throw InputError(message:"Select an observed accessibility path or unique identifier") }
                var owner: pid_t = 0; AXUIElementGetPid(element,&owner); try require(owner == pid,"Accessibility element belongs to another process")
                if let expected = request["role"] as? String { try require(attribute(element,kAXRoleAttribute) as? String == expected,"Accessibility role changed") }
                if let expected = request["title"] as? String { try require(attribute(element,kAXTitleAttribute) as? String == expected,"Accessibility title changed") }
                try verifyOwner()
                if command == "action" { let action = request["action"] as? String ?? kAXPressAction; try require(actions(element).contains(action),"Requested accessibility action is unavailable"); dispatched = true; try require(AXUIElementPerformAction(element,action as CFString) == .success,"Accessibility action did not acknowledge success") }
                else { try require(attribute(element,kAXRoleAttribute) as? String != "AXSecureTextField","Secure fields cannot be edited by this test driver"); guard let value = request["value"] as? String, value.count <= 4096 else { throw InputError(message:"Supply a bounded text value") }; dispatched = true; try require(AXUIElementSetAttributeValue(element,kAXValueAttribute as CFString,value as CFString) == .success,"Accessibility value was not accepted") }
                result["status"] = "Dispatched"
            } else {
                guard let number = request["window"] as? NSNumber, let record = owned.first(where: { ($0[kCGWindowNumber as String] as? NSNumber) == number }), let dictionary = record[kCGWindowBounds as String] as? [String:Any], let bounds = CGRect(dictionaryRepresentation:dictionary as CFDictionary), let window = windowServer ? app : windows.first(where: { frame($0).map { abs($0.minX-bounds.minX)<1 && abs($0.minY-bounds.minY)<1 && abs($0.width-bounds.width)<1 && abs($0.height-bounds.height)<1 } ?? false }) else { throw InputError(message:"Selected on-screen window is absent from the verified PID's accessibility windows") }
                result["window"] = number; result["frame"] = rectangle(bounds)
                if command != "screenshot" {
                    guard let expected = request["frame"] as? [String:Double] else { throw InputError(message:"Supply the observed window frame before input") }
                    try require(rectangle(bounds).allSatisfy { expected[$0.key] == $0.value },"Window geometry changed; inspect before input")
                }
                if command == "screenshot" {
                    try require(CGPreflightScreenCaptureAccess(),"Native screenshot permission is unavailable; no permission changes were attempted")
                    guard let output = request["output"] as? String, output.hasPrefix("/"), output.hasSuffix(".png"), !FileManager.default.fileExists(atPath:output) else { throw InputError(message:"Choose a new absolute PNG output path") }
                    let content = try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
                    guard let target = content.windows.first(where: { $0.windowID == number.uint32Value && $0.owningApplication?.processID == pid }) else { throw InputError(message:"Screenshot window identity changed") }
                    let configuration = SCStreamConfiguration(); configuration.width = Int(bounds.width*2); configuration.height = Int(bounds.height*2); configuration.showsCursor = false
                    let image = try await SCScreenshotManager.captureImage(contentFilter:SCContentFilter(desktopIndependentWindow:target),configuration:configuration)
                    guard let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath:output) as CFURL,UTType.png.identifier as CFString,1,nil) else { throw InputError(message:"Unable to create screenshot output") }
                    CGImageDestinationAddImage(destination,image,nil); try require(CGImageDestinationFinalize(destination),"Unable to finalize screenshot")
                    result["output"] = output; result["pixelWidth"] = image.width; result["pixelHeight"] = image.height
                } else {
                    // Validate the entire input before activation or any dispatched event.
                    if command == "key" {
                        guard let key = request["key"] as? String else { throw InputError(message:"Supply a key chord") }
                        let parts=key.lowercased().split(separator:"+").map(String.init)
                        try require(parts.last.map { keyCodes[$0] != nil } ?? false,"Unsupported key")
                        try require(parts.dropLast().allSatisfy { ["cmd","super","shift","alt","option","ctrl"].contains($0) },"Unsupported key modifier")
                    } else {
                        try require(["left","middle","right"].contains(request["button"] as? String ?? "left"),"Unsupported pointer button")
                        for names in command == "drag" ? [["x","y"],["toX","toY"]] : [["x","y"]] {
                            guard let x=request[names[0]] as? Double,let y=request[names[1]] as? Double else { throw InputError(message:"Supply window-relative point coordinates") }
                            let target=names[0]=="toX" ? request["toFrame"] as? [String:Double] : nil
                            try require(x.isFinite&&y.isFinite&&x>=0&&y>=0&&x<(target?["width"] ?? bounds.width)&&y<(target?["height"] ?? bounds.height),"Pointer point is outside the selected window")
                        }
                    }
                    try require(CGPreflightPostEventAccess(),"Native input permission is unavailable; no permission changes were attempted")
                    try verifyOwner()
                    if !windowServer { try require(AXUIElementSetAttributeValue(app,kAXFrontmostAttribute as CFString,kCFBooleanTrue) == .success,"Unable to activate the verified PID"); AXUIElementPerformAction(window,kAXRaiseAction as CFString) }
                    try await Task.sleep(nanoseconds:200_000_000)
                    try require(foreground(),"Verified PID did not become frontmost")
                    if command == "key" && windowServer { try require((topWindow()?[kCGWindowNumber as String] as? NSNumber)==number,"Another Wizard window owns keyboard focus") }
                    if command == "key" && !windowServer { guard let focused = attribute(app,kAXFocusedWindowAttribute) else { throw InputError(message:"No focused Wizard window") }; try require(frame(focused as! AXUIElement) == bounds,"Another Wizard window owns keyboard focus") }
                    func post(_ event: CGEvent) throws { try verifyOwner(); event.setIntegerValueField(.eventSourceUserData,value:42); dispatched = true; event.postToPid(pid) }
                    if command == "key" {
                        guard let key = request["key"] as? String else { throw InputError(message:"Supply a key chord") }
                        let parts = key.lowercased().split(separator:"+").map(String.init)
                        guard let last = parts.last, let code = keyCodes[last] else { throw InputError(message:"Unsupported key") }
                        var flags: CGEventFlags = []
                        for modifier in parts.dropLast() { switch modifier { case "cmd","super":flags.insert(.maskCommand); case "shift":flags.insert(.maskShift); case "alt","option":flags.insert(.maskAlternate); case "ctrl":flags.insert(.maskControl); default:throw InputError(message:"Unsupported key modifier") } }
                        guard let down = CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:true), let up = CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:false) else { throw InputError(message:"Unable to create keyboard events") }
                        down.flags = flags; up.flags = flags; try post(down); try await Task.sleep(nanoseconds:50_000_000); try post(up)
                        result["key"] = key; result["eventsPosted"] = 2
                    } else {
                        var destinationBounds=bounds
                        if command=="drag",let toNumber=request["toWindow"] as? NSNumber {
                            guard let record=owned.first(where:{ ($0[kCGWindowNumber as String] as? NSNumber)==toNumber }),let dictionary=record[kCGWindowBounds as String] as? [String:Any],let rectangle=CGRect(dictionaryRepresentation:dictionary as CFDictionary),let expected=request["toFrame"] as? [String:Double],(windowServer || windows.contains(where:{frame($0)==rectangle})) else { throw InputError(message:"Drag destination window is not owned") }
                            try require(selfRectangle(rectangle).allSatisfy{expected[$0.key]==$0.value},"Drag destination window geometry changed");destinationBounds=rectangle
                        }
                        func point(_ x: String,_ y: String,_ within: CGRect) throws -> CGPoint {
                            guard let a = request[x] as? Double, let b = request[y] as? Double else { throw InputError(message:"Supply window-relative point coordinates") }
                            try require(a.isFinite && b.isFinite && a>=0 && b>=0 && a<within.width && b<within.height,"Pointer point is outside the selected window")
                            return CGPoint(x:within.minX+a,y:within.minY+b)
                        }
                        let from = try point("x","y",bounds), to = command == "drag" ? try point("toX","toY",destinationBounds) : from
                        let buttonName=request["button"] as? String ?? "left"
                        let button: CGMouseButton=buttonName=="middle" ? .center : buttonName=="right" ? .right : .left
                        let downType: CGEventType=buttonName=="middle" ? .otherMouseDown : buttonName=="right" ? .rightMouseDown : .leftMouseDown
                        let dragType: CGEventType=buttonName=="middle" ? .otherMouseDragged : buttonName=="right" ? .rightMouseDragged : .leftMouseDragged
                        let upType: CGEventType=buttonName=="middle" ? .otherMouseUp : buttonName=="right" ? .rightMouseUp : .leftMouseUp
                        var held=false,lastPoint=from
                        defer { if held,(try? verifyOwner()) != nil,foreground(),let release=CGEvent(mouseEventSource:nil,mouseType:upType,mouseCursorPosition:lastPoint,mouseButton:button) { release.post(tap:.cghidEventTap) } }
                        func mouse(_ type: CGEventType,_ location: CGPoint) throws {
                            guard let event = CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:location,mouseButton:button) else { throw InputError(message:"Unable to create mouse event") }
                            event.setIntegerValueField(.mouseEventClickState,value:1)
                            try verifyOwner(); try require(foreground(),"Verified PID lost foreground input ownership")
                            if windowServer {
                                guard let top=topWindow(location) else { throw InputError(message:"Pointer target has no visible window") }
                                try require((top[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value==pid,"Another application covers the pointer target")
                                if type==downType { try require((top[kCGWindowNumber as String] as? NSNumber)==number,"Another Wizard window covers the pointer target") }
                            } else {
                                var hit: AXUIElement?; try require(AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(),Float(location.x),Float(location.y),&hit) == .success,"Pointer hit test failed")
                                guard let hit=hit else { throw InputError(message:"Pointer target disappeared") };var hitPID:pid_t=0;AXUIElementGetPid(hit,&hitPID);try require(hitPID==pid,"Another application covers the pointer target")
                                if type==downType { let hitWindow=attribute(hit,kAXWindowAttribute) as! AXUIElement? ?? hit;try require(frame(hitWindow)==bounds,"Another Wizard window covers the pointer target") }
                            }
                            dispatched = true; event.post(tap:.cghidEventTap); lastPoint=location; held=type != upType
                        }
                        let duration=request["durationMs"] as? Int ?? 300
                        try require(request["durationMs"] == nil || (command=="drag" && duration>=300 && duration<=10000),"Drag duration must be 300–10000 milliseconds")
                        try mouse(downType,from);result["pointerDownAt"]=Date().timeIntervalSince1970*1000;try await Task.sleep(nanoseconds:50_000_000)
                        let steps=max(10,duration/33)
                        if command == "drag" { let began=ProcessInfo.processInfo.systemUptime;for step in 1...steps { try mouse(dragType,CGPoint(x:from.x+(to.x-from.x)*Double(step)/Double(steps),y:from.y+(to.y-from.y)*Double(step)/Double(steps)));let remaining=Double(duration)*Double(step)/Double(steps)/1000-(ProcessInfo.processInfo.systemUptime-began);if remaining>0 { try await Task.sleep(nanoseconds:UInt64(remaining*1_000_000_000)) } } }
                        try mouse(upType,to);result["pointerUpAt"]=Date().timeIntervalSince1970*1000;result["button"]=buttonName; result["eventsPosted"] = command == "drag" ? steps+2 : 2; result["from"] = [from.x,from.y]; result["to"] = [to.x,to.y]
                    }
                    result["dispatch"] = command == "key" ? "coregraphics-pid-keyboard" : "coregraphics-hid-pointer"
                    result["status"] = "Dispatched"
                }
            }
            try verifyOwner(); emit(result)
        } catch {
            emit(["status":dispatched ? "Unknown":"Blocked","error":(error as? InputError)?.message ?? String(describing:error),"driver":"macos-verified-pid"]); exit(1)
        }
    }
    static func selfRectangle(_ value: CGRect) -> [String:Double] { rectangle(value) }
}
