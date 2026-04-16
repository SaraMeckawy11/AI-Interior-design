# Livinai - AI Interior & Exterior Design App

Livinai is an innovative AI-powered mobile application designed to transform and reimagine interior and exterior spaces. Users can upload photos of their rooms or buildings, select from various design styles, and generate stunning new AI renditions of their spaces.

## 🚀 Features

- **AI Room Generation:** Redesign interiors (bedrooms, living rooms, kitchens, etc.) and exteriors with different architectural styles (modern, minimalist, industrial, etc.).
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
- **AI Processing (Python):** Python-based microservices (`Interior/app.py`, `interiorAI/handler.py`) handle image diffusion model pipelines to process image generation requests.

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
