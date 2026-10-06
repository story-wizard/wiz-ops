import Cocoa
import ApplicationServices
import ScreenCaptureKit
import ImageIO
import UniformTypeIdentifiers
import CoreImage
import Darwin
import Carbon
nonisolated(unsafe) var inputInterrupted=false

func gestureModifiers(_ request:[String:Any]) throws -> [(String,CGKeyCode,CGEventFlags)] {
    guard request["modifiers"] == nil || request["modifiers"] is [String] else { throw InputError(message:"Invalid pointer modifiers") }
    let names=request["modifiers"] as? [String] ?? []
    try require(names.isEmpty || ["click","drag"].contains(request["command"] as? String ?? ""),"Modifiers require a pointer click or drag")
    try require(names.count<=4 && Set(names).count==names.count,"Pointer modifiers must be unique")
    return try names.map { name in
        switch name { case "cmd":return (name,55,.maskCommand);case "shift":return (name,56,.maskShift);case "alt":return (name,58,.maskAlternate);case "ctrl":return (name,59,.maskControl);default:throw InputError(message:"Unsupported pointer modifier") }
    }
}
func gesturePath(_ request:[String:Any],_ bounds:CGRect) throws -> [CGPoint]? {
    guard let value=request["path"] else { return nil }
    guard let points=value as? [[String:Double]],points.count>=2,points.count<=128 else { throw InputError(message:"Drag path needs 2–128 points") }
    try require(request["command"] as? String == "drag" && (request["toWindow"] as? Int == nil || request["toWindow"] as? Int == request["window"] as? Int),"Path must stay in one owned window")
    let result=try points.map { p -> CGPoint in
        guard p.count==2,let x=p["x"],let y=p["y"],x.isFinite,y.isFinite,x>=0,y>=0,x<bounds.width,y<bounds.height else { throw InputError(message:"Path point escaped the owned window") }
        return CGPoint(x:x,y:y)
    }
    try require(points.first?["x"] == request["x"] as? Double && points.first?["y"] == request["y"] as? Double && points.last?["x"] == request["toX"] as? Double && points.last?["y"] == request["toY"] as? Double,"Path endpoints differ from the gesture")
    return result
}

// Resolve the Unix process on every invocation. NSRunningApplication is diagnostic only.
struct InputError: Error {
    let message: String, code: String, diagnostics: [String:Any]
    init(message:String,code:String="native_input_blocked",diagnostics:[String:Any]=[:]) { self.message=message;self.code=code;self.diagnostics=diagnostics }
}
func require(_ condition: Bool, _ message: String) throws { if !condition { throw InputError(message: message) } }
func ps(_ arguments: [String]) throws -> String {
    let process = Process(), pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps"); process.arguments = arguments
    process.standardOutput = pipe; process.standardError = FileHandle.nullDevice
    let finished = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in finished.signal() }
    try process.run(); let data = pipe.fileHandleForReading.readDataToEndOfFile(); finished.wait()
    try require(process.terminationStatus == 0, "Unable to inspect the selected Unix process")
    return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
}
func canonicalExecutable(_ path: String) -> String { URL(fileURLWithPath:path).resolvingSymlinksInPath().path }
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
func pointerOverlay(_ entry:[String:Any]) -> Bool {
    // The compositor reports the mouse cursor itself above the clicked point.
    // Exclude only its reserved system layer, never arbitrary Window Server UI.
    (entry[kCGWindowOwnerName as String] as? String) == "Window Server" &&
    (entry[kCGWindowLayer as String] as? NSNumber)?.int32Value == CGWindowLevelForKey(.cursorWindow)
}
func requirePointerWindow(_ top:[String:Any]?,at point:CGPoint,pid:pid_t,window:NSNumber,starting:Bool) throws {
    var facts:[String:Any]=["point":[point.x,point.y],"expectedPid":pid,"expectedWindow":window]
    guard let top=top else { throw InputError(message:"Pointer target has no visible window",code:"pointer_target_unavailable",diagnostics:facts) }
    // Identify the covering window without retaining another app's document title.
    facts["occluder"]=["pid":top[kCGWindowOwnerPID as String] ?? 0,"window":top[kCGWindowNumber as String] ?? 0,"owner":top[kCGWindowOwnerName as String] ?? "","layer":top[kCGWindowLayer as String] ?? 0,"frame":top[kCGWindowBounds as String] ?? [String:Any]()]
    if (top[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value != pid { throw InputError(message:"Another application covers the pointer target",code:"pointer_occluded",diagnostics:facts) }
    if starting && (top[kCGWindowNumber as String] as? NSNumber) != window { throw InputError(message:"Another Wizard window covers the pointer target",code:"pointer_window_obscured",diagnostics:facts) }
}
func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func actions(_ element: AXUIElement) -> [String] { var names: CFArray?; AXUIElementCopyActionNames(element, &names); return names as? [String] ?? [] }
let keyCodes: [String:CGKeyCode] = [
    "escape":53,"return":36,"tab":48,"space":49,"delete":51,"k":40,"n":45,"s":1,"a":0,"z":6,"d":2,"c":8,"v":9,
    "b":CGKeyCode(kVK_ANSI_B),"g":CGKeyCode(kVK_ANSI_G),"j":CGKeyCode(kVK_ANSI_J),"l":CGKeyCode(kVK_ANSI_L),"i":CGKeyCode(kVK_ANSI_I),"o":CGKeyCode(kVK_ANSI_O),
    "left":CGKeyCode(kVK_LeftArrow),"right":CGKeyCode(kVK_RightArrow),"up":CGKeyCode(kVK_UpArrow),"down":CGKeyCode(kVK_DownArrow),
    "home":CGKeyCode(kVK_Home),"end":CGKeyCode(kVK_End),"pageup":CGKeyCode(kVK_PageUp),"pagedown":CGKeyCode(kVK_PageDown),"forwarddelete":CGKeyCode(kVK_ForwardDelete),
    "comma":CGKeyCode(kVK_ANSI_Comma),"period":CGKeyCode(kVK_ANSI_Period),
    "0":CGKeyCode(kVK_ANSI_0),"1":CGKeyCode(kVK_ANSI_1),"2":CGKeyCode(kVK_ANSI_2),"3":CGKeyCode(kVK_ANSI_3),"4":CGKeyCode(kVK_ANSI_4),
    "5":CGKeyCode(kVK_ANSI_5),"6":CGKeyCode(kVK_ANSI_6),"7":CGKeyCode(kVK_ANSI_7),"8":CGKeyCode(kVK_ANSI_8),"9":CGKeyCode(kVK_ANSI_9),
    "f1":CGKeyCode(kVK_F1),"f2":CGKeyCode(kVK_F2),"f3":CGKeyCode(kVK_F3),"f4":CGKeyCode(kVK_F4),"f5":CGKeyCode(kVK_F5),"f6":CGKeyCode(kVK_F6),
    "f7":CGKeyCode(kVK_F7),"f8":CGKeyCode(kVK_F8),"f9":CGKeyCode(kVK_F9),"f10":CGKeyCode(kVK_F10),"f11":CGKeyCode(kVK_F11),"f12":CGKeyCode(kVK_F12)
]
func scrollEvent(at point:CGPoint,deltaX:Int32,deltaY:Int32) -> CGEvent? {
    guard let event=CGEvent(scrollWheelEvent2Source:nil,units:.pixel,wheelCount:2,wheel1:-deltaY,wheel2:-deltaX,wheel3:0) else { return nil }
    // The event otherwise retains the cursor location from before mouseMoved is posted.
    event.location=point;return event
}
func emit(_ value: [String: Any]) { if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) { FileHandle.standardOutput.write(data); print() } }

// Accept a complete compositor frame produced after this capture request, never an idle buffer.
func freshFrame(_ status: Int, _ displayed: UInt64, after requested: UInt64) -> Bool {
    status == SCFrameStatus.complete.rawValue && displayed > requested
}
final class CaptureFrame: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let lock=NSLock(), requested:UInt64
    private var sample:CMSampleBuffer?, failure:Error?
    init(after requested:UInt64) { self.requested=requested }
    func stream(_ stream:SCStream,didOutputSampleBuffer buffer:CMSampleBuffer,of type:SCStreamOutputType) {
        guard type == .screen,buffer.isValid,
              let info=(CMSampleBufferGetSampleAttachmentsArray(buffer,createIfNecessary:false) as? [[SCStreamFrameInfo:Any]])?.first,
              let status=info[.status] as? Int,let tick=info[.displayTime] as? UInt64,
              freshFrame(status,tick,after:requested),CMSampleBufferGetImageBuffer(buffer) != nil else { return }
        lock.lock();defer{lock.unlock()};if sample == nil { sample=buffer }
    }
    func stream(_ stream:SCStream,didStopWithError error:Error) { lock.lock();defer{lock.unlock()};failure=error }
    func read() throws -> CMSampleBuffer? { lock.lock();defer{lock.unlock()};if let failure { throw failure };return sample }
}
func captureFrame(_ target:SCWindow,_ display:SCDisplay,_ bounds:CGRect) async throws -> (CGImage,[String:Any]) {
    let requested=mach_absolute_time(),output=CaptureFrame(after:requested)
    let config=SCStreamConfiguration();config.width=Int(bounds.width*2);config.height=Int(bounds.height*2)
    config.sourceRect=bounds.offsetBy(dx:-display.frame.minX,dy:-display.frame.minY);config.showsCursor=false
    config.minimumFrameInterval=CMTime(value:1,timescale:30);config.queueDepth=3
    let stream=SCStream(filter:SCContentFilter(display:display,including:[target]),configuration:config,delegate:output)
    try stream.addStreamOutput(output,type:.screen,sampleHandlerQueue:DispatchQueue(label:"athanor-capture"))
    try await stream.startCapture()
    do {
        var sample:CMSampleBuffer?
        for _ in 0..<80 { sample=try output.read();if sample != nil { break };try await Task.sleep(nanoseconds:50_000_000) }
        try require(sample != nil,"No fresh complete compositor frame arrived within four seconds")
        guard let buffer=CMSampleBufferGetImageBuffer(sample!),
              let image=CIContext().createCGImage(CIImage(cvPixelBuffer:buffer),from:CGRect(x:0,y:0,width:CVPixelBufferGetWidth(buffer),height:CVPixelBufferGetHeight(buffer))),
              let info=(CMSampleBufferGetSampleAttachmentsArray(sample!,createIfNecessary:false) as? [[SCStreamFrameInfo:Any]])?.first else { throw InputError(message:"Fresh capture has no image or frame metadata") }
        try await stream.stopCapture()
        return (image,["source":"screencapturekit-display-window-stream","requestedTick":requested,"displayedTick":info[.displayTime]!,"frameStatus":"complete","display":display.displayID])
    } catch { try? await stream.stopCapture();throw error }
}

func sampleRGB(_ image: CGImage) throws -> Data {
    var rgba=[UInt8](repeating:0,count:64*32*4)
    try rgba.withUnsafeMutableBytes { bytes in
        guard let context=CGContext(data:bytes.baseAddress,width:64,height:32,bitsPerComponent:8,bytesPerRow:64*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else { throw InputError(message:"Capture pixel sample unavailable") }
        context.draw(image,in:CGRect(x:0,y:0,width:64,height:32))
    }
    return Data(stride(from:0,to:rgba.count,by:4).flatMap{Array(rgba[$0..<$0+3])})
}
// Poll actual foreground readiness; an already-ready process needs no settling delay.
@MainActor func waitForForeground(_ foreground: () -> Bool) async throws -> Double {
    let began=ProcessInfo.processInfo.systemUptime
    while !foreground() {
        try require(!inputInterrupted,"Input interrupted before foreground readiness")
        try require(ProcessInfo.processInfo.systemUptime-began<0.2,"Verified PID did not become frontmost")
        try await Task.sleep(nanoseconds:20_000_000)
    }
    return (ProcessInfo.processInfo.systemUptime-began)*1000
}
@main struct NativeInput {
    static func main() async {
        var dispatched = false, pointerCleanupReleased = false, modifierCleanupReleased=false
        do {
            let args = CommandLine.arguments
            if args.count == 2 && args[1] == "--desktop-lease" {
                let file="/private/tmp/athanor-desktop-\(getuid()).lock", fd=open(file,O_CREAT|O_RDWR|O_NOFOLLOW,mode_t(0o600))
                try require(fd>=0,"Cannot open the shared foreground lease")
                defer { close(fd) }
                var info=stat();try require(fstat(fd,&info)==0 && info.st_uid==getuid() && (info.st_mode & S_IFMT)==S_IFREG,"Foreground lease must be an owned regular file")
                try require(flock(fd,LOCK_EX|LOCK_NB)==0,"Another Athanor session owns the desktop. Stop or finish that session first.")
                emit(["status":"Acquired","pid":getpid(),"started":try ps(["-p",String(getpid()),"-o","lstart="]),"file":file]);fflush(stdout)
                _=FileHandle.standardInput.readDataToEndOfFile();return
            }
            try require(args.count == 5 && args[1] == "--executable" && args[3] == "--request", "Use --executable PATH --request JSON_FILE")
            signal(SIGTERM){_ in inputInterrupted=true};signal(SIGINT){_ in inputInterrupted=true}
            let executable = canonicalExecutable(args[2])
            try require(executable.hasPrefix("/") && [".app/Contents/MacOS/wizard-bin",".app/Contents/MacOS/wizard"].contains(where:executable.hasSuffix), "Select the exact packaged Wizard executable")
            let data = try Data(contentsOf: URL(fileURLWithPath: args[4])); try require(data.count <= 131072, "Input request exceeds the size limit")
            guard let request = try JSONSerialization.jsonObject(with: data) as? [String: Any], let command = request["command"] as? String else { throw InputError(message: "Supply a JSON command") }
            let permitted = ["inspect","screenshot","action","set-value","click","drag","key","type","scroll"]
            try require(permitted.contains(command), "Unsupported native input command")
            let matches = try ps(["-axo","pid=,comm="]).split(separator: "\n").compactMap { line -> pid_t? in
                let fields = line.trimmingCharacters(in: .whitespaces).split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
                guard fields.count == 2, canonicalExecutable(String(fields[1]).trimmingCharacters(in: .whitespaces)) == executable else { return nil }
                return pid_t(fields[0])
            }
            try require(matches.count == 1, "Expected exactly one running process for the selected executable")
            let pid = matches[0], started = try ps(["-p",String(pid),"-o","lstart="])
            if command != "inspect" { try require(request["pid"] as? Int32 == pid && request["started"] as? String == started,"Supply the PID and start time from a fresh inspection; process identity changed or is absent") }
            func verifyOwner() throws {
                try require(try canonicalExecutable(ps(["-p",String(pid),"-o","comm="])) == executable && ps(["-p",String(pid),"-o","lstart="]) == started, "The selected process exited or its identity changed")
            }
            let windowServer=request["mode"] as? String == "window-server"
            if windowServer { try require(["inspect","screenshot","click","drag","key","type","scroll"].contains(command),"WindowServer mode supports observations and physical input only") }
            else { try require(AXIsProcessTrusted(), "Native accessibility permission is unavailable; no permission changes were attempted") }
            let app = AXUIElementCreateApplication(pid)
            let windows=windowServer ? [] : attribute(app,kAXWindowsAttribute) as? [AXUIElement] ?? []
            try require(windowServer || !windows.isEmpty,"The verified PID did not expose AXWindows")
            func topWindow(_ at: CGPoint? = nil) -> [String:Any]? {
                let entries=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
                return entries.first { entry in
                    if pointerOverlay(entry) { return false }
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
                result["permissions"]=["input":CGPreflightPostEventAccess(),"screenCapture":CGPreflightScreenCaptureAccess(),"accessibility":AXIsProcessTrusted()]
                result["frontmost"]=foreground()
                if let front=topWindow() { result["frontWindow"]=["window":front[kCGWindowNumber as String] ?? 0,"pid":front[kCGWindowOwnerPID as String] ?? 0,"title":front[kCGWindowName as String] ?? ""] }
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
                if command != "screenshot" || request["frame"] != nil {
                    guard let expected = request["frame"] as? [String:Double] else { throw InputError(message:"Supply the observed window frame before input") }
                    try require(rectangle(bounds).allSatisfy { expected[$0.key] == $0.value },"Window geometry changed; inspect before input")
                }
                if command == "screenshot" {
                    try require(CGPreflightScreenCaptureAccess(),"Native screenshot permission is unavailable; no permission changes were attempted")
                    guard let output = request["output"] as? String, output.hasPrefix("/"), output.hasSuffix(".png"), !FileManager.default.fileExists(atPath:output) else { throw InputError(message:"Choose a new absolute PNG output path") }
                    let content = try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
                    guard let target = content.windows.first(where: { $0.windowID == number.uint32Value && $0.owningApplication?.processID == pid }) else { throw InputError(message:"Screenshot window identity changed") }
                    guard let display=content.displays.first(where:{$0.frame.contains(bounds)}) else { throw InputError(message:"Capture window must be fully visible on one display; move it and inspect again") }
                    let (captured,capture)=try await captureFrame(target,display,bounds)
                    var image=captured
                    if let r=request["captureRect"] as? [String:Double] {
                        guard let x=r["x"],let y=r["y"],let width=r["width"],let height=r["height"],
                              [x,y,width,height].allSatisfy({$0.isFinite}),x>=0,y>=0,width>0,height>0,x+width<=bounds.width,y+height<=bounds.height,
                              let crop=captured.cropping(to:CGRect(x:x*Double(captured.width)/bounds.width,y:y*Double(captured.height)/bounds.height,width:width*Double(captured.width)/bounds.width,height:height*Double(captured.height)/bounds.height)) else { throw InputError(message:"Capture region escaped the owned window") }
                        image=crop;result["captureRect"]=r
                    }
                    let current=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
                    try require(current.contains{($0[kCGWindowNumber as String] as? NSNumber)==number && ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value==pid && ($0[kCGWindowBounds as String] as? [String:Any]).flatMap{CGRect(dictionaryRepresentation:$0 as CFDictionary)}==bounds},"Window changed during capture; inspect and capture again")
                    guard let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath:output) as CFURL,UTType.png.identifier as CFString,1,nil) else { throw InputError(message:"Unable to create screenshot output") }
                    CGImageDestinationAddImage(destination,image,nil); try require(CGImageDestinationFinalize(destination),"Unable to finalize screenshot")
                    result["output"] = output; result["pixelWidth"] = image.width; result["pixelHeight"] = image.height;result["capture"]=capture
                    result["sampleRgb"] = try sampleRGB(image).base64EncodedString();result["sampleWidth"]=64;result["sampleHeight"]=32
                } else {
                    // Validate the entire input before activation or any dispatched event.
                    if command == "key" {
                        guard let key = request["key"] as? String else { throw InputError(message:"Supply a key chord") }
                        let parts=key.lowercased().split(separator:"+").map(String.init)
                        try require(parts.last.map { keyCodes[$0] != nil } ?? false,"Unsupported key")
                        try require(parts.dropLast().allSatisfy { ["cmd","super","shift","alt","option","ctrl"].contains($0) },"Unsupported key modifier")
                    } else if command == "type" {
                        guard let text=request["text"] as? String,text.utf16.count>0,text.utf16.count<=4096 else { throw InputError(message:"Supply 1–4096 text characters") }
                        try require(!text.unicodeScalars.contains { ($0.value<32 && ![9,10,13].contains($0.value)) || $0.value==127 },"Text contains unsupported control codes")
                    } else {
                        let modifiers=try gestureModifiers(request);_ = try gesturePath(request,bounds)
                        try require(!modifiers.contains{CGEventSource.flagsState(.hidSystemState).contains($0.2)},"A requested modifier is already held; release it before testing")
                        let clicks=request["clickCount"] as? Int ?? 1
                        try require(request["clickCount"] == nil || command=="click" && [1,2].contains(clicks),"Click count must be one or two")
                        try require(["left","middle","right"].contains(request["button"] as? String ?? "left"),"Unsupported pointer button")
                        for names in command == "drag" ? [["x","y"],["toX","toY"]] : [["x","y"]] {
                            guard let x=request[names[0]] as? Double,let y=request[names[1]] as? Double else { throw InputError(message:"Supply window-relative point coordinates") }
                            let target=names[0]=="toX" ? request["toFrame"] as? [String:Double] : nil
                            try require(x.isFinite&&y.isFinite&&x>=0&&y>=0&&x<(target?["width"] ?? bounds.width)&&y<(target?["height"] ?? bounds.height),"Pointer point is outside the selected window")
                        }
                        if command == "scroll" {
                            let dx=request["deltaX"] as? Int ?? 0,dy=request["deltaY"] as? Int ?? 0
                            try require(abs(dx)<=2000 && abs(dy)<=2000 && (dx != 0 || dy != 0),"Scroll must be nonzero and at most 2000 pixels per axis")
                        }
                    }
                    try require(CGPreflightPostEventAccess(),"Native input permission is unavailable; no permission changes were attempted")
                    try verifyOwner()
                    if !windowServer { try require(AXUIElementSetAttributeValue(app,kAXFrontmostAttribute as CFString,kCFBooleanTrue) == .success,"Unable to activate the verified PID"); AXUIElementPerformAction(window,kAXRaiseAction as CFString) }
                    if windowServer { result["foregroundWaitMs"] = try await waitForForeground(foreground) }
                    else { try await Task.sleep(nanoseconds:200_000_000) }
                    try verifyOwner()
                    try require(foreground(),"Verified PID did not remain frontmost")
                    // Floating panels can lead WindowServer order without owning keyboard focus.
                    // Only the instrumented wrapper can supply a fresh AppKit key-window proof.
                    let verifiedKey=request["verifiedKeyWindow"] as? NSNumber
                    func keyboardWindowMatches() -> Bool { verifiedKey.map { $0==number } ?? ((topWindow()?[kCGWindowNumber as String] as? NSNumber)==number) }
                    if ["key","type"].contains(command) && windowServer {
                        if verifiedKey != nil { let age=Date().timeIntervalSince1970*1000-(request["focusObservedAt"] as? Double ?? 0);try require(age>=0 && age<2000,"Keyboard focus observation expired; inspect again") }
                        try require(keyboardWindowMatches(),"Another Wizard window owns keyboard focus; physically click the intended control first")
                    }
                    if ["key","type"].contains(command) && !windowServer { guard let focused = attribute(app,kAXFocusedWindowAttribute) else { throw InputError(message:"No focused Wizard window") }; try require(frame(focused as! AXUIElement) == bounds,"Another Wizard window owns keyboard focus") }
                    func post(_ event: CGEvent) throws { try verifyOwner();try require(!inputInterrupted,"Keyboard input interrupted");event.setIntegerValueField(.eventSourceUserData,value:42); dispatched = true; event.postToPid(pid) }
                    if command == "key" {
                        guard let key = request["key"] as? String else { throw InputError(message:"Supply a key chord") }
                        let parts = key.lowercased().split(separator:"+").map(String.init)
                        guard let last = parts.last, let code = keyCodes[last] else { throw InputError(message:"Unsupported key") }
                        var flags: CGEventFlags = []
                        for modifier in parts.dropLast() { switch modifier { case "cmd","super":flags.insert(.maskCommand); case "shift":flags.insert(.maskShift); case "alt","option":flags.insert(.maskAlternate); case "ctrl":flags.insert(.maskControl); default:throw InputError(message:"Unsupported key modifier") } }
                        guard let down = CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:true), let up = CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:false) else { throw InputError(message:"Unable to create keyboard events") }
                        var heldKey=false
                        defer {if heldKey {up.postToPid(pid)}}
                        down.flags = flags; up.flags = flags; try post(down);heldKey=true; try await Task.sleep(nanoseconds:50_000_000); try post(up);heldKey=false
                        result["key"] = key; result["eventsPosted"] = 2
                    } else if command == "type" {
                        let text=request["text"] as! String
                        // Small Unicode batches preserve surrogate pairs; no clipboard is touched.
                        var batches=[[UniChar]](),batch=[UniChar]()
                        for scalar in text.unicodeScalars { let units=Array(String(scalar).utf16);if batch.count+units.count>20 { batches.append(batch);batch=[] };batch.append(contentsOf:units) };if !batch.isEmpty { batches.append(batch) }
                        for units in batches {
                            try require(foreground() && keyboardWindowMatches(),"Keyboard focus changed during text entry")
                            guard let down=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:true),let up=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:false) else { throw InputError(message:"Unable to create Unicode keyboard events") }
                            units.withUnsafeBufferPointer { p in down.keyboardSetUnicodeString(stringLength:units.count,unicodeString:p.baseAddress!);up.keyboardSetUnicodeString(stringLength:units.count,unicodeString:p.baseAddress!) }
                            try post(down);try post(up);try await Task.sleep(nanoseconds:20_000_000)
                        }
                        result["utf16Units"]=text.utf16.count;result["eventsPosted"]=batches.count*2
                    } else if command == "scroll" {
                        let point=CGPoint(x:bounds.minX+(request["x"] as! Double),y:bounds.minY+(request["y"] as! Double))
                        try requirePointerWindow(topWindow(point),at:point,pid:pid,window:number,starting:true)
                        guard let move=CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:point,mouseButton:.left),let wheel=scrollEvent(at:point,deltaX:Int32(request["deltaX"] as? Int ?? 0),deltaY:Int32(request["deltaY"] as? Int ?? 0)) else { throw InputError(message:"Unable to create physical scroll events") }
                        try verifyOwner();dispatched=true;move.post(tap:.cghidEventTap);try await Task.sleep(nanoseconds:50_000_000);try verifyOwner();try require(foreground() && (topWindow(point)?[kCGWindowNumber as String] as? NSNumber)==number,"Scroll lost target ownership");wheel.post(tap:.cghidEventTap);result["eventsPosted"]=2;result["deltaX"]=request["deltaX"] ?? 0;result["deltaY"]=request["deltaY"] ?? 0
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
                        let path=try gesturePath(request,bounds)?.map{CGPoint(x:bounds.minX+$0.x,y:bounds.minY+$0.y)} ?? [from,to]
                        let modifiers=try gestureModifiers(request),originalFlags=CGEventSource.flagsState(.hidSystemState)
                        var flags=originalFlags,heldModifiers=[(CGEvent,CGEventFlags)]()
                        let modifierEvents=try modifiers.map { modifier -> (CGEvent,CGEvent,CGEventFlags) in
                            guard let down=CGEvent(keyboardEventSource:nil,virtualKey:modifier.1,keyDown:true),let up=CGEvent(keyboardEventSource:nil,virtualKey:modifier.1,keyDown:false) else { throw InputError(message:"Cannot allocate modifier cleanup events") }
                            down.type = .flagsChanged;up.type = .flagsChanged;return (down,up,modifier.2)
                        }
                        defer { for (up,flag) in heldModifiers.reversed(){flags.remove(flag);up.flags=flags;up.post(tap:.cghidEventTap);modifierCleanupReleased=true} }
                        for (down,up,flag) in modifierEvents {try verifyOwner();try require(!inputInterrupted && foreground(),"Gesture interrupted before modifier dispatch");flags.insert(flag);down.flags=flags;dispatched=true;down.post(tap:.cghidEventTap);heldModifiers.append((up,flag))}
                        result["modifiers"]=modifiers.map{$0.0};result["pathPoints"]=path.count
                        let buttonName=request["button"] as? String ?? "left"
                        let button: CGMouseButton=buttonName=="middle" ? .center : buttonName=="right" ? .right : .left
                        let downType: CGEventType=buttonName=="middle" ? .otherMouseDown : buttonName=="right" ? .rightMouseDown : .leftMouseDown
                        let dragType: CGEventType=buttonName=="middle" ? .otherMouseDragged : buttonName=="right" ? .rightMouseDragged : .leftMouseDragged
                        let upType: CGEventType=buttonName=="middle" ? .otherMouseUp : buttonName=="right" ? .rightMouseUp : .leftMouseUp
                        var held=false,lastPoint=from,clickState=1
                        // Allocate the balancing event before dispatch. Ownership guards still
                        // protect every new gesture; losing ownership must not leave our HID button held.
                        guard let release=CGEvent(mouseEventSource:nil,mouseType:upType,mouseCursorPosition:from,mouseButton:button) else { throw InputError(message:"Unable to create pointer cleanup event") }
                        defer { if held { release.location=lastPoint; release.setIntegerValueField(.eventSourceUserData,value:42); release.post(tap:.cghidEventTap); held=false; pointerCleanupReleased=true } }
                        func mouse(_ type: CGEventType,_ location: CGPoint) throws {
                            guard let event = CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:location,mouseButton:button) else { throw InputError(message:"Unable to create mouse event") }
                            event.setIntegerValueField(.mouseEventClickState,value:Int64(clickState));event.flags=flags
                            try verifyOwner(); try require(!inputInterrupted && foreground(),"Gesture interrupted or verified PID lost foreground input ownership")
                            if windowServer {
                                try requirePointerWindow(topWindow(location),at:location,pid:pid,window:number,starting:type==downType)
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
                        if command == "drag" { let began=ProcessInfo.processInfo.systemUptime;for step in 1...steps {
                            let progress=Double(step)/Double(steps)*Double(path.count-1),index=min(path.count-2,Int(progress)),fraction=progress-Double(index),a=path[index],b=path[index+1]
                            try mouse(dragType,CGPoint(x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction));let remaining=Double(duration)*Double(step)/Double(steps)/1000-(ProcessInfo.processInfo.systemUptime-began);if remaining>0 { try await Task.sleep(nanoseconds:UInt64(remaining*1_000_000_000)) }
                        } }
                        try mouse(upType,to);result["pointerUpAt"]=Date().timeIntervalSince1970*1000;result["button"]=buttonName; result["eventsPosted"] = command == "drag" ? steps+2 : 2; result["from"] = [from.x,from.y]; result["to"] = [to.x,to.y]
                        if command=="click" && request["clickCount"] as? Int == 2 {clickState=2;try await Task.sleep(nanoseconds:50_000_000);try mouse(downType,from);try mouse(upType,to);result["eventsPosted"]=4}
                    }
                    result["dispatch"] = ["key","type"].contains(command) ? "coregraphics-pid-keyboard" : "coregraphics-hid-pointer"
                    try await Task.sleep(nanoseconds:100_000_000);try verifyOwner()
                    try require(foreground(),"Verified PID lost foreground ownership after input; inspect before continuing")
                    result["modifierCleanupReleased"]=modifierCleanupReleased
                    result["postInput"]=["frontmost":true,"observedAt":Date().timeIntervalSince1970*1000,"frontWindow":topWindow()?[kCGWindowNumber as String] ?? 0]
                    if ["click","drag","scroll"].contains(command),let cursor=CGEvent(source:nil)?.location {
                        let expected=result["to"] as? [Double] ?? [bounds.minX+(request["x"] as! Double),bounds.minY+(request["y"] as! Double)]
                        result["cursor"]=[cursor.x,cursor.y]
                        // Applications may warp the cursor after release; behavior is verified separately.
                        result["cursorMatchesEndpoint"]=abs(cursor.x-expected[0])<3 && abs(cursor.y-expected[1])<3
                    }
                    result["status"] = "Dispatched"
                }
            }
            try verifyOwner(); emit(result)
        } catch {
            let failure=error as? InputError
            emit(["status":dispatched ? "Unknown":"Blocked","error":failure?.message ?? String(describing:error),"code":failure?.code ?? "native_input_failed","diagnostics":failure?.diagnostics ?? [:],"driver":"macos-verified-pid","pointerCleanupReleased":pointerCleanupReleased,"modifierCleanupReleased":modifierCleanupReleased]); exit(1)
        }
    }
    static func selfRectangle(_ value: CGRect) -> [String:Double] { rectangle(value) }
}
