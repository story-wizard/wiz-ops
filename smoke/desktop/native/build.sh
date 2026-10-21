#!/bin/sh
set -eu
cd "$(dirname "$0")"
build_root="$(node --input-type=module -e "import {dataDirectory} from '../../runner/files.mjs'; console.log(dataDirectory() + '/native')")"
mkdir -p "$build_root/styles" "$build_root/project"
cat > "$build_root/project/CMakeLists.txt" <<CMAKE
cmake_minimum_required(VERSION 3.24)
project(AthanorSelectedQt LANGUAGES CXX OBJCXX)
set(CMAKE_AUTOMOC ON)
find_package(Qt6 REQUIRED COMPONENTS Widgets Test Quick)
add_library(wizard_smoke MODULE "$PWD/bridge.cpp")
set_source_files_properties("$PWD/bridge.cpp" PROPERTIES LANGUAGE OBJCXX)
target_compile_features(wizard_smoke PRIVATE cxx_std_17)
set_source_files_properties("$PWD/bridge.cpp" PROPERTIES COMPILE_OPTIONS "-fobjc-arc;-fblocks")
target_link_options(wizard_smoke PRIVATE -Wl,-headerpad_max_install_names)
target_link_libraries(wizard_smoke PRIVATE Qt6::Widgets Qt6::Test Qt6::Quick "-framework AppKit" "-framework ApplicationServices" "-framework ScreenCaptureKit")
set_target_properties(wizard_smoke PROPERTIES SUFFIX .dylib LIBRARY_OUTPUT_DIRECTORY "$build_root/styles")
CMAKE
cmake -S "$build_root/project" -B "$build_root/cmake" -DCMAKE_PREFIX_PATH="${SMOKE_QT_PREFIX:-/opt/homebrew/opt/qtbase}" -DCMAKE_BUILD_TYPE=Release
cmake --build "$build_root/cmake" --parallel 2
