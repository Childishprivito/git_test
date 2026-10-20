# Getting FoodLog on TestFlight

## 1. Join the Apple Developer Program ($99/year)
On your iPhone, install the **Apple Developer** app › *Account* › *Enroll Now*.
Choose **Individual**. Approval usually takes from a few minutes up to 2 days.

## 2. Make an App Store Connect API key (lets Expo build for you)
On the MacBook (you need to download a file):
1. Go to appstoreconnect.apple.com › *Users and Access* › *Integrations* ›
   *App Store Connect API* › *Team Keys* › **+**.
2. Name it "Expo", access **Admin**, *Generate*.
3. **Download** the `.p8` file (Apple only lets you download it once). Note the
   **Key ID** and the **Issuer ID** shown on that page.

## 3. Give the key to Expo
expo.dev › *projectfitness* › *Credentials* › *iOS* › add an
**App Store Connect API Key**: upload the `.p8`, enter the Key ID and Issuer ID.

## 4. Build
expo.dev › *projectfitness* › *Workflows* › **TestFlight** › *Run*.
The first run creates the signing certificate and the app record. It takes
roughly 20–40 minutes, plus queue time. If a step asks for something, tell Claude.

## 5. Install
When Apple finishes processing (another 5–30 minutes), install the **TestFlight**
app on your iPhone; FoodLog shows up there. To add friends: App Store Connect ›
FoodLog › *TestFlight* › add testers by email.

After that, everyday changes still arrive over the air (no rebuild). Only changes
that add native code (like Siri) need a new TestFlight run.
