cmake_minimum_required(VERSION 3.20)
project(lolly_jxl LANGUAGES C CXX)
add_subdirectory("${LIBJXL_SOURCE}" codec EXCLUDE_FROM_ALL)
add_executable(lolly-jxl adapter.cc)
target_link_libraries(lolly-jxl PRIVATE jxl jxl_cms)
set_target_properties(lolly-jxl PROPERTIES SUFFIX ".mjs")
target_link_options(lolly-jxl PRIVATE
  -O3 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker
  -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16777216
  -sMAXIMUM_MEMORY=805306368 -sABORTING_MALLOC=0 -sDYNAMIC_EXECUTION=0
  "-sEXPORTED_FUNCTIONS=['_malloc','_free','_lj_decode','_lj_encode','_lj_recompress','_lj_data','_lj_size','_lj_info','_lj_error','_lj_reset']"
  "-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPF64']")

# Manual synthetic-fixture generator; excluded from the client build.
add_executable(jxl-fixtures EXCLUDE_FROM_ALL fixtures.cc)
target_link_libraries(jxl-fixtures PRIVATE jxl jxl_cms)
set_target_properties(jxl-fixtures PROPERTIES SUFFIX ".cjs")
target_link_options(jxl-fixtures PRIVATE -sENVIRONMENT=node -sALLOW_MEMORY_GROWTH=1)
