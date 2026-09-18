cmake_minimum_required(VERSION 3.13)
project(appmodules)
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

option(DEMO_NATIVE_CRASH_ENABLED "Enable explicit native crash demonstration" OFF)
add_library(demo_native_faults SHARED faults/DemoNativeCrash.cpp)
target_compile_definitions(demo_native_faults PRIVATE DEMO_NATIVE_CRASH_ENABLED=$<BOOL:${DEMO_NATIVE_CRASH_ENABLED}>)
target_compile_options(demo_native_faults PRIVATE -g -fno-omit-frame-pointer)
