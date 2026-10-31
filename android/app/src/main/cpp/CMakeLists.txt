cmake_minimum_required(VERSION 3.22.1)
project(qgwhisper C CXX)
set(CMAKE_CXX_STANDARD 17)

# whisper.cpp source is fetched by android/scripts/fetch-whisper.sh (pinned tag) into android/third_party/
set(WHISPER_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/whisper.cpp)
if(NOT EXISTS ${WHISPER_DIR}/CMakeLists.txt)
    message(FATAL_ERROR "whisper.cpp not found at ${WHISPER_DIR}: run android/scripts/fetch-whisper.sh")
endif()

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
if(ANDROID_ABI STREQUAL "arm64-v8a")
    set(GGML_CPU_ARM_ARCH "armv8.2-a+fp16" CACHE STRING "" FORCE)
endif()
add_subdirectory(${WHISPER_DIR} whisper EXCLUDE_FROM_ALL)

add_library(qgwhisper SHARED qg_whisper.cpp jni.cpp)
target_link_libraries(qgwhisper PRIVATE whisper log android)
target_compile_options(qgwhisper PRIVATE -O3)
