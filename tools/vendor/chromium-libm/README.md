These files are byte-identical to V8's bundled glibc sine/cosine library at
`ddc9a95905de5268332a8f0216dc2bc67d26e829`, the V8 revision pinned by
Chromium `148.0.7778.96` (the frozen golden browser).

Source: https://github.com/v8/v8/tree/ddc9a95905de5268332a8f0216dc2bc67d26e829/third_party/glibc/src/sysdeps/ieee754/dbl-64

The accompanying LICENSE is copied from that revision's
`third_party/glibc/LICENSE`. Source notices are retained. These files are used
only by the optional Node replay compatibility adapter, never the web bundle.

Chromium's `V8_USE_LIBM_TRIG_FUNCTIONS` changes `sin` and `cos` to these
implementations. It does not change tangent or inverse trigonometric
functions. Node omits that V8 build flag. Host system glibc differs for a few
inputs, including `48 * Math.PI / 180`, so linking just `-lm` is insufficient.
