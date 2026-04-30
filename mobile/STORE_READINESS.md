# Store Readiness

## Implemented scaffolding

- Expo app config exists in `mobile/app.json`
- EAS profiles exist in `mobile/eas.json`
- native upload flow exists
- backend-driven long-running job state exists
- Expo dependency health passes via `expo-doctor`

## Still required before App Store / Play Store submission

### Product identity

- replace placeholder bundle identifier `com.example.padelanalyzermobile`
- replace placeholder Android package `com.example.padelanalyzermobile`
- finalize app display name, icon set, splash, and marketing copy

### Production backend

- deploy the API over HTTPS
- provision persistent storage and backups for uploads/database
- install Python analysis dependencies on the deployed backend
- add runtime monitoring and alerting

### Privacy and policy

- publish a privacy policy URL
- define video retention and deletion rules
- document how uploaded videos and derived pose data are stored
- review YouTube ingestion policy before shipping that feature on mobile

### Release operations

- connect Expo/EAS to the Apple and Google developer accounts
- create preview/internal build lanes
- configure crash reporting and product analytics
- run a device matrix on modern iPhone and Android hardware

### QA gates

- verify upload -> job -> analysis on simulator
- verify the same flow on at least one real iPhone and one real Android device
- verify local-network and hosted API configurations
- verify failure UX when backend is unavailable or Python dependencies are missing

## Suggested release sequence

1. Internal builds through EAS preview profiles
2. TestFlight / Play internal testing
3. Closed beta with hosted backend only
4. Public store submission after privacy copy and support flow are in place
