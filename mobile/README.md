# WUW Cars — Mobile App

React Native + Expo app for WUW Rentals.

## Setup

```bash
cd mobile
npm install
```

Copy the env file and set your backend URL:

```bash
cp .env.example .env
# Edit EXPO_PUBLIC_API_URL to point at your backend
# e.g. http://192.168.x.x:3000  (LAN IP for physical device)
#      http://localhost:3000     (iOS simulator on Mac only)
```

## Run

```bash
npm run ios      # iOS simulator
npm run android  # Android emulator
npm start        # Expo Go (scan QR)
```

## Screens

| Screen | Route |
|--------|-------|
| Welcome / Onboarding | `/(auth)/welcome` |
| Sign In | `/(auth)/sign-in` |
| Sign Up | `/(auth)/sign-up` |
| Browse (Home) | `/(tabs)/` |
| Trips | `/(tabs)/trips` |
| Saved | `/(tabs)/saved` |
| Profile | `/(tabs)/profile` |
| Car Detail | `/vehicle/[id]` |
| Search & Filters | `/search` |
| Booking Checkout | `/booking/checkout` |
| Booking Confirmation | `/booking/confirmation` |

## Assets

Place your app icon and splash image in `assets/`:
- `assets/icon.png` (1024×1024)
- `assets/splash.png` (1284×2778 or any 9:19.5 ratio)

## Stack

- **Expo SDK 52** + Expo Router v4 (file-based navigation)
- **TanStack Query v5** for data fetching
- **Zustand** for auth state (token stored in SecureStore)
- **React Hook Form + Zod** for form validation
- **Fraunces** (display serif) + **Inter** (sans) via @expo-google-fonts
