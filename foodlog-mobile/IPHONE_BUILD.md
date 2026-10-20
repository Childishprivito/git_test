# Install FoodLog on your iPhone from your Mac (free)

This builds the real app, not Expo Go, so Apple's on-device AI works (and Apple
Health, if your free account allows it). It uses your normal Apple ID; no $99
developer account. The catch: the app stops opening after **7 days**, and then you
run the last step again.

## One-time setup (about 30–45 minutes, mostly downloads)

1. **Xcode**: install it from the Mac App Store (version 26 or newer). Open it once
   and let it install its extra components.
2. **Sign in**: in Xcode, choose *Xcode › Settings › Accounts › +* and add your Apple ID.
3. **Tools**: open the Terminal app and run these, one at a time:
   ```sh
   xcode-select --install          # command line tools (skip if it says already installed)
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install node cocoapods
   ```
4. **Get the code**:
   ```sh
   git clone https://github.com/Childishprivito/git_test.git
   cd git_test/foodlog-mobile
   npm ci
   ```
5. **iPhone**: plug it into the Mac with a cable, unlock it, and tap *Trust*.
   Then on the iPhone: *Settings › Privacy & Security › Developer Mode › On*
   (the phone restarts). If you don't see Developer Mode yet, do step 6 once first.

## Build and install

```sh
cd git_test/foodlog-mobile
git pull
npm ci
npm run ios:device:free
```

Pick your iPhone when it asks. The first build takes 10–20 minutes.

- If it stops with a **signing** error: open `ios/FoodLog.xcworkspace` in Xcode, click
  *FoodLog* in the left list, then *Signing & Capabilities*, and choose your name
  ("Personal Team") under *Team*. Then run the command again.
- If it says the **bundle identifier** is taken, tell Claude; it will change it.
- On the iPhone, the first time: *Settings › General › VPN & Device Management*,
  tap your Apple ID and *Trust*.

`ios:device:free` leaves Apple Health out, because free accounts may not be allowed
to use it. To try with Apple Health, run `npm run ios:device` instead; if signing
fails, go back to the free one.

## Using it

- Open **FoodLog** from your home screen. Your log in Expo Go doesn't move over
  automatically (it's a separate app), unless you've set up the sync server.
- **Coach › AI settings › Apple on-device** uses Apple Intelligence: free and
  offline. It needs an iPhone 15 Pro or newer with Apple Intelligence turned on.
- App updates still arrive over the air from the `preview` channel, like Expo Go,
  as long as they don't add new native code. When Claude says a change needs a
  rebuild, run the *Build and install* steps again.
- After 7 days the app won't open: plug in and run `npm run ios:device:free` again.
  Your data stays on the phone.

With the $99 Apple Developer account, none of this is needed: EAS builds in the
cloud, the app doesn't expire, and you can share it through TestFlight.
