#!/bin/sh
set -eu
cd "$(dirname "$0")"
build_root="$(node --input-type=module -e "import {dataDirectory} from '../../runner/files.mjs'; console.log(dataDirectory() + '/native')")"
mkdir -p "$build_root/styles"
/opt/homebrew/share/qt/libexec/moc bridge.cpp -o "$build_root/bridge.moc"
clang++ -std=c++17 -x objective-c++ -fobjc-arc -fblocks -fPIC -dynamiclib -Wl,-headerpad_max_install_names bridge.cpp -I"$build_root" -o "$build_root/styles/libwizard_smoke.dylib" $(pkg-config --cflags --libs Qt6Widgets Qt6Test) -lobjc -framework AppKit -framework ApplicationServices -framework ScreenCaptureKit
