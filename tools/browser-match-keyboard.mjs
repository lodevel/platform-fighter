/** Playwright names numpad digits with NumLock off (e.g. Numpad1 = End,
 * keyCode35). Match defaults use NumLock-on digit codes97 etc. CDP emits
 * trusted browser events through the same DOM keyboard route; no resolver
 * state is injected. Human device/NumLock ergonomics remain unmeasured. */
export async function createBrowserMatchKeyboard(page) {
  const cdp = await page.context().newCDPSession(page);
  const event = key => {
    const digit = /^Numpad([0-9])$/.exec(key)?.[1];
    return digit === undefined ? null : {key: digit, code: key,
      windowsVirtualKeyCode: 96 + Number(digit), nativeVirtualKeyCode: 96 + Number(digit), isKeypad: true};
  };
  return {
    async down(key) {const e = event(key); if(e) await cdp.send('Input.dispatchKeyEvent', {type: 'keyDown', ...e, text:e.key, unmodifiedText:e.key}); else await page.keyboard.down(key);},
    async up(key) {const e = event(key); if(e) await cdp.send('Input.dispatchKeyEvent', {type: 'keyUp', ...e}); else await page.keyboard.up(key);},
  };
}
