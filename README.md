# SwachhLens 🌍🤖

**Agentic AI Waste Response System**

SwachhLens is a next-generation, AI-powered waste management platform that leverages a multi-agent system to automate and optimize the entire lifecycle of waste complaints. From citizen intake to worker dispatch and verification, discrete, narrowly-scoped AI agents collaborate to ensure efficient, timely, and transparent waste resolution.

---

## 🚀 Overview

SwachhLens transforms how municipal waste is reported and managed. Instead of a traditional linear helpdesk, SwachhLens utilizes an ecosystem of specialized AI agents:
- **Intake Agent**: Processes citizen reports (photos, videos, GPS).
- **Vision Analysis Agent**: Extracts waste categories, volume, and potential hazards using advanced vision models.
- **Correlation Agent**: Detects duplicate reports and clusters them.
- **Priority & Resource Planning Agent**: Assigns severity scores and resource requirements.
- **Dispatch/Matching Agent**: Finds the most suitable and nearest sanitation worker.
- **Approval Agent**: Auto-approves routine dispatches or escalates high-risk cases for human review.
- **Verification Agent**: Validates job completion by comparing before/after photos.

## 🛠 Tech Stack

**Frontend:**
- React 18
- Vite
- TailwindCSS
- React-Leaflet (for mapping and geolocation)
- Lucide React (for icons)

**Backend:**
- Node.js & Express
- PostgreSQL with PostGIS (for spatial queries)

**AI & Processing:**
- Vision Models (Gemini Vision, GPT-4V, YOLO - integration capability)
- Sharp (for image processing)

**Communications:**
- Twilio (SMS notifications)
- Nodemailer (Email notifications)

## 📁 Project Structure

```text
SwachhLens/
├── backend/                  # Node.js Express backend & AI Agent Logic
│   ├── agents/               # AI Agents (e.g., dispatchAgent.js)
│   ├── scripts/              # DB seeding and utility scripts
│   └── server.js             # Express API entry point
├── public/                   # Static assets
├── specs/                    # Architectural and Agent specifications
├── src/                      # React frontend source code
│   ├── components/           # Reusable UI components
│   └── ...
├── .env                      # Environment variables
├── package.json              # Project dependencies and scripts
└── vite.config.js            # Vite configuration
```

## ⚙️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [PostgreSQL](https://www.postgresql.org/) with [PostGIS](https://postgis.net/) extension
- API keys for integrated services (e.g., LLMs, Twilio, Email SMTP)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/swachhlens.git
   cd SwachhLens
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Ensure you have a `.env` file in the root directory. You will need to configure necessary environment variables such as database connection strings, Twilio keys, and email SMTP credentials.
   
   Example `.env`:
   ```env
   # Backend Port
   PORT=5000
   
   # Database
   DATABASE_URL=postgres://user:password@localhost:5432/swachhlens
   
   # External APIs
   TWILIO_ACCOUNT_SID=your_twilio_sid
   TWILIO_AUTH_TOKEN=your_twilio_token
   # Add your specific AI provider API keys here
   ```

4. **Database Setup:**
   Ensure PostgreSQL is running and seed the database with mock workers if needed:
   ```bash
   npm run seed:workers
   ```

### Running the Application

You can run both the frontend and backend concurrently using the provided npm script:

```bash
npm run dev:full
```

- **Frontend:** Runs via Vite, typically on `http://localhost:5173`
- **Backend:** Runs via Express, typically on `http://localhost:5000`

Alternatively, you can run them separately:
- Backend only: `npm run server`
- Frontend only: `npm run dev`

## 🤖 The Agentic Flow

1. **Intake**: A citizen uploads an image and GPS coordinates via the web UI.
2. **Analysis**: The image is analyzed by the Vision Analysis Agent.
3. **Correlation**: Checks are made against existing complaints to avoid duplicate efforts.
4. **Planning & Dispatch**: Priority is set, and the Dispatch Agent assigns the task to a nearby worker.
5. **Execution**: Worker receives the task (via Twilio SMS/email), completes it, and uploads proof.
6. **Verification**: The Verification Agent validates the cleanup.
7. **Feedback**: The system learns and updates worker/citizen trust scores.

## 🤝 Contributing

Contributions are welcome! Please follow these steps:
1. Fork the repository.
2. Create a new branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

## 📄 License

This project is licensed under the MIT License.