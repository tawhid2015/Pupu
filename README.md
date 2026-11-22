<p align="center">
  <img src="showcase/tauri/src-tauri/icons/128x128@2x.png" width="128" alt="Pupu Icon">
</p>

<h1 align="center">Pupu</h1>

<p align="center">
  <strong>Your Intelligent AI Desktop Companion with Bilingual Voice & Vision</strong><br>
  <em>Lives on your screen, listens and talks back in Bengali & English, keeps you on track, and navigates your apps.</em>
</p>

<p align="center">
  <a href="https://github.com/tawhid2015/Pupu"><img src="https://img.shields.io/badge/GitHub-Pupu-blue?style=for-the-badge&logo=github" alt="Pupu GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-green.svg?style=for-the-badge" alt="AGPL-3.0 License"></a>
  <a href="https://www.faxacademy.org/"><img src="https://img.shields.io/badge/Website-Fax%20Academy-78ffe2?style=for-the-badge" alt="Fax Academy"></a>
  <a href="https://youtube.com/@faxacademy"><img src="https://img.shields.io/badge/YouTube-@faxacademy-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
</p>

<p align="center">
  <strong>Created by Tawhid</strong><br>
  Creator of Pupu · Founder of <a href="https://www.faxacademy.org/">Fax Academy</a>
</p>

---

## 🌟 Overview

**Pupu** is a cross-platform desktop AI assistant built on Tauri 2, Rust, and Node.js. It hovers beside your cursor or on your screen, speaks naturally in Bengali and English, remembers your commitments, visually inspects your desktop, rings buttons you need to click, and automates desktop tasks.

### Highlights
- 🎙️ **Bilingual Speech & Voice:** Offline neural Text-to-Speech (TTS) in Bangla and English powered by Chatterbox & MLX, plus cloud options (Fish Audio, Google Gemini Live).
- 👂 **Voice Recognition (STT):** Offline Bangla ASR, Whisper, and Apple Speech recognition with seamless Bangla-English code-switching dictation.
- 👁️ **Visual Grounding:** Reads visible text, identifies UI buttons, takes area snapshots, and explains diagrams right on your screen.
- 🤖 **Multi-Model AI Support:** Runs 100% offline with local models (Ollama with Llama 3.2, Qwen3-VL) or connects to Claude, OpenAI ChatGPT, and Google Gemini.
- ✋ **Hands & Automation:** Safely opens apps, navigates web pages, performs clicks, executes shell commands, and takes notes.
- 🧠 **Memory & Routines:** Remembers facts about you, tracks recurring commitments, and executes scheduled routines in the background.

---

## 🎭 Companion Characters

Choose your favorite look and voice from the **Appearance** settings:

| Character | Description |
| :--- | :--- |
| **JARVIS** | A glowing LED sphere of light that ripples as it speaks |
| **Sarah** | Elegant pixel companion with warm speech |
| **Roamie** | The original glowing pixel buddy |
| **GlayOS** | Futuristic robot head with an animated eye |
| **Ultren** | Chrome metallic companion with illuminated optics |
| **Anime Girl**| Expressive animated anime companion |
| **Adrian** | Calm and focused companion |
| **Rita X** | Professional retro-styled companion |

---

## 📋 System Prerequisites

Before building Pupu from source, ensure your environment has the following tools installed:

### 1. Operating System
- **macOS:** macOS 13.5 (Ventura) or later (Apple Silicon M1/M2/M3/M4 or Intel x86_64).
- **Windows:** Windows 10 / 11 (64-bit).
- **Linux:** Ubuntu 24.04+, Fedora 39+, or Debian 13+ (glibc 2.38+ required).

### 2. Development Toolchains
- **Rust & Cargo:** Stable 1.80+ ([Install Rust](https://rustup.rs/)):
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- **Node.js:** v22.x LTS or newer ([Install Node.js](https://nodejs.org/)):
  ```bash
  node -v # should be >= v22.0.0
  ```
- **Xcode Command Line Tools** (macOS only):
  ```bash
  xcode-select --install
  ```
- **Python:** 3.10 or 3.11 (used for local Chatterbox voice runtime on macOS).
- **Ollama (Optional, for offline AI):** [Download Ollama](https://ollama.com/) and pull your preferred model:
  ```bash
  ollama pull llama3.2:latest
  ```

---

## 🚀 How to Install and Build

Follow these step-by-step instructions to set up, build, and install Pupu:

### Step 1: Clone the Repository

```bash
git clone https://github.com/tawhid2015/Pupu.git
cd Pupu
```

### Step 2: Install Sidecar Dependencies

Pupu uses a modular Node.js sidecar for tool handling, memory management, and AI streaming:

```bash
cd showcase/tauri/sidecar
npm ci
```

Run the unit test suite to verify all components:
```bash
npm test
```

Bundle the sidecar into production distribution format:
```bash
npm run build
```

### Step 3: Offline Voice Engine Setup (Chatterbox)

If you are using the built-in offline Bangla & English voice engine on macOS Apple Silicon:

1. Navigate to the voice directory:
   ```bash
   cd voice/chatterbox
   ```
2. Run the preparation script to set up the Python virtual environment, MLX dependencies, and model checkpoints:
   ```bash
   ./prepare.sh
   cd ../../..
   ```

*(If you prefer cloud voices, you can skip this step and enter your Fish Audio or Google Gemini API key inside the app settings).*

### Step 4: Build the Desktop Application

Return to the Tauri root directory (`showcase/tauri`):

```bash
cd showcase/tauri
```

#### Option A: Quick Development Build (Faster iteration)
```bash
./build.sh dev
```

#### Option B: Release Production Bundle (.app / installer)
```bash
TAURI_BUNDLES=app ./build.sh
```

On macOS, this compiles Rust binaries, links native Swift helpers, packages the Node runtime, and produces the complete bundle at:
```
showcase/tauri/src-tauri/target/release/bundle/macos/Pupu.app
```

### Step 5: Install & Run Pupu

Copy the compiled application to your system Applications folder:

```bash
# macOS
rm -rf /Applications/Pupu.app
cp -R src-tauri/target/release/bundle/macos/Pupu.app /Applications/Pupu.app
open /Applications/Pupu.app
```

---

## ⌨️ Shortcuts & Daily Usage

| Action | macOS Shortcut | Windows / Linux Shortcut |
| :--- | :--- | :--- |
| **Talk to Pupu** (Hold to speak, release to send) | `Hold Option + Command` | `Hold Ctrl + Alt` |
| **Quick Ask Bubble** (Type question at cursor) | `Tap Control + Command` | `Tap Ctrl + Shift` |
| **Summon / Dismiss Pupu** | `Alt + S` | `Ctrl + Alt + S` |
| **Ask About a Screen Area** | `Alt + D` | `Ctrl + Shift + A` |
| **Show Reminders / List** | `Control + Alt + L` | `Ctrl + Alt + L` |
| **Stop Speech / Dismiss Bubble** | `Esc` | `Esc` |

---

## ⚙️ Configuration & Settings

Access the **Pupu Settings Panel** via the menu bar icon or by clicking **Open Panel**:

1. **Model:** Select between **Local models** (Ollama, LM Studio) or **Cloud Providers** (Claude, OpenAI, Gemini).
   - *For Ollama:* Ensure context length is configured: `OLLAMA_CONTEXT_LENGTH=32768 ollama serve`.
2. **Speaking:**
   - **Reply Language:** Choose `Bangla`, `English`, or `Automatic (English + Bangla)`.
   - **TTS Engine:** Choose `VoiceStudio (Built-in offline)`, `Fish Audio`, or `Gemini TTS`.
3. **Listening:**
   - Configure **Talking** vs **Hands-Free** wake word listening.
   - Set up **Dictation to clipboard** with global shortcut keys.
4. **General & Permissions:**
   - Toggle **Allow File Edits & Commands** for desktop tool automation.
   - Enable **Open at Login** so Pupu is ready when you start your computer.

---

## 🛡️ Security & Privacy

- **Local-first by design:** When running with local models (Ollama) and built-in Chatterbox TTS, your audio, text, and screen data never leave your computer.
- **Explicit safety boundaries:** Shell commands, file edits, and application control are gated by user permission toggles in `Settings -> General`.
- **Protected credentials:** Cloud API keys are securely stored in the native OS Keychain (macOS Keychain, Windows DPAPI, or Linux Secret Service).

---

## 📜 License & Credits

- **License:** Open source under the [AGPL-3.0 License](LICENSE).
- **Created by:** Tawhid, Founder of [Fax Academy](https://www.faxacademy.org/).
- **YouTube:** [@faxacademy](https://youtube.com/@faxacademy)
- **GitHub:** [https://github.com/tawhid2015/Pupu](https://github.com/tawhid2015/Pupu)
