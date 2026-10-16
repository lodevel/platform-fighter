/* N-API bridge to the pinned libm sources used by Chromium's trig mode.
 * No gameplay code or values are implemented here. */
#include <node_api.h>
#include <math.h>
double glibc_sin(double);
double glibc_cos(double);

static double argument(napi_env env, napi_value value) {
  double result;
  if (napi_get_value_double(env, value, &result) != napi_ok) {
    napi_throw_type_error(env, NULL, "libm trig requires a number");
    return NAN;
  }
  return result;
}

#define UNARY(name) \
static napi_value call_##name(napi_env env, napi_callback_info info) { \
  size_t count = 1; napi_value args[1], result; \
  napi_get_cb_info(env, info, &count, args, NULL, NULL); \
  double x = count ? argument(env, args[0]) : NAN; \
  napi_create_double(env, glibc_##name(x), &result); return result; \
}
UNARY(sin)
UNARY(cos)
#define ENTRY(name) {#name, NULL, call_##name, NULL, NULL, NULL, napi_default, NULL}
NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = { ENTRY(sin), ENTRY(cos) };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
