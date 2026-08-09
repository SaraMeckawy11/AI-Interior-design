# Livinai - AI Interior & Exterior Design App

Livinai is an innovative AI-powered mobile application designed to transform and reimagine interior and exterior spaces. Users can upload photos of their rooms or buildings, select from various design styles, and generate stunning new AI renditions of their spaces.

## 🚀 Features

- **AI Room Generation:** Redesign interiors (bedrooms, living rooms, kitchens, etc.) and exteriors with different architectural styles (modern, minimalist, industrial, etc.), powered by `black-forest-labs/FLUX.2-klein-4B` with the Gen‑Klein prompt architecture shared with the Livinai web studio.
- **3D Walkthrough:** Draw a floor plan on a metric grid, assign a type and style to each room, then walk through the furnished result in real time. The exact `Livinai_web` walkthrough exporter—vendored in this repository—builds the measured geometry, web furniture variations, placement, and PBR materials as one textured GLB. The app displays that scene instead of reconstructing an approximation on-device.
- **One entry point per starting material:** a room photo (Interior), an outdoor photo (Exterior), or a plan (3D Walkthrough — which also links through to the AI floor-plan render for anyone starting from a photo of a plan).
- **Smart Image Processing:** Advanced AI models seamlessly apply requested color tones and styles to the user's provided baseline images.
- **Virtual Coins System:** A flexible monetization system where users consume virtual coins to generate designs.
- **Rewarded Content:** Integration with Google AdMob allows free users to earn coins by watching rewarded video ads.
- **Premium Upgrades:** In-app purchases via RevenueCat allow users to subscribe or purchase coin bundles.
- **User Collections:** View and manage a personal gallery of all previously generated designs.
- **Authentication:** Secure user accounts and progress syncing.

## 🛠 Tech Stack

### Mobile Frontend

- **Framework:** React Native with Expo (File-based routing using `expo-router`)
- **State Management:** Zustand (`authStore.js`)
- **Monetization:** `react-native-purchases` (RevenueCat), `react-native-google-mobile-ads` (AdMob)
- **UI & Styling:** Custom CSS-in-JS pattern

### Backend Services

- **Main API (Node.js):** Handles authentication, subscription syncing, coin balance updates, and saving generated designs to collections.
- **AI Processing (Python):** two engines behind one routing rule — FLUX.2 [klein] for photo redesigns, and SD 1.5 + depth/seg ControlNets for guided floor plans, where the drawn room polygons are rasterised into the conditioning mask. `modal/app.py` is the original and serves every design it can; `interiorAI/` is the RunPod worker the backend falls back to, running the same engines ported into `inference_core.py` alongside the shared `prompt_engine.py`. `interio/handler.py` is an older canny-based handler on its own endpoint.

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for what to redeploy and in what order.

## 📦 Project Structure

- `app/`: Expo Router application screens (Tabs, Onboarding, Authentication, Profile, Create).
- `assets/`: Fonts, static images, SVG icons, and stylesheets.
- `backend/`: Node.js Express server handling core app business logic.
- `components/`: Reusable UI components (Auth modals, Image selectors, Loaders).
- `context/`: React Context providers (e.g., Theme setting).
- `Interior/` & `interiorAI/`: Python Dockerized services wrapping the AI image generation capabilities.

## 🏁 Getting Started

### Prerequisites

- Node.js (v18+)
- Expo CLI
- Python (If running the backend AI services locally)
- A connected physical device or iOS Simulator / Android Emulator.

### Installation

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd Livinai
   ```

2. **Install frontend dependencies:**

   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create a `.env` file in the root based on your credentials (`EXPO_PUBLIC_SERVER_URI`, AdMob IDs, RevenueCat API Key).

4. **Start the Expo development server:**
   ```bash
   npx expo start
   ```

## 📝 License

This project is proprietary and confidential. Ensure you have the proper credentials to run the backend and ad services.
