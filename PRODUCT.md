# SwingCourt

Motion controlled tennis for your living room, no console required.

## What it is

SwingCourt turns any MacBook and a couple of iPhones into a local multiplayer motion tennis game. One device (the MacBook) acts as the screen and game host. Each player opens a web page on their iPhone, which becomes their racket controller. Swings, timing, and direction are read from the phone's motion sensors and translated into shots on the court shown on the Mac.

No app installs, no accounts, no internet connection required beyond the local Wi-Fi network everyone is already on.

## Why

Local multiplayer party games have mostly disappeared from phones and laptops in favor of app store downloads and account sign ins. SwingCourt is meant to recreate that "everyone gather around one screen" feeling from motion controlled console games, using devices people already have in their pockets.

## Core experience

1. Host starts the game on their MacBook and a local web server spins up.
2. A QR code (or simple local address) is shown on the host screen.
3. Players scan it with their iPhone camera and open the controller page in Safari.
4. Each phone asks for motion sensor permission, once, with a tap.
5. Players see their assigned side and a "ready" state.
6. The host starts the match, and swings on the phone control shots on screen.

## Target platforms

- **Host**: macOS, any modern browser (Chrome, Safari)
- **Controller**: iOS Safari, no app required
- **Network**: local Wi-Fi only, no cloud dependency for gameplay

## Gameplay scope (v1)

- 1v1 singles matches
- Swing detection: forehand, backhand, serve
- Simple shot power based on swing speed
- Ball physics and automatic player movement (players don't move around the court manually, similar in spirit to classic motion tennis games)
- Score tracking per game and set
- Sound effects for hits, bounces, and points

## Explicitly out of scope for v1

- Doubles (2v2)
- Manual player movement/positioning
- Online play across different networks
- Custom character creation
- Persistent accounts or stats across sessions

## Technical approach (high level)

- **Server**: Node.js, serves both the host game page and the controller page
- **Real time sync**: WebSockets (Socket.IO) between controllers and host
- **Motion input**: DeviceMotion / DeviceOrientation APIs in iOS Safari
- **Rendering**: Three.js (3D court) or Phaser (2D court), decision pending prototyping
- **Local HTTPS**: required for iOS motion sensor access, handled via mkcert or a tunnel service during development

> **Note on this section.** These were the starting assumptions, and three of
> them have since been decided differently after review. Socket.IO was dropped
> for raw `ws`, rendering was settled on Three.js without a prototype, and local
> HTTPS uses publicly trusted LAN certificates rather than mkcert or a tunnel.
> The reasoning is in `llm-knowledge/decisions/`. Everything above this note is
> the product intent and still stands.

## Design principles

- **Zero install**: everything runs in a browser, on both ends
- **Zero friction setup**: one QR code from device discovery to gameplay
- **Local first**: gameplay never depends on an internet connection
- **Own assets only**: no reused characters, music, or branding from existing motion sports games, to keep the project clean to share and publish

## Non goals

SwingCourt is not trying to be a precise motion tracking system or a competitive esports title. Timing and swing intent matter more than perfect 1:1 motion capture. The bar for "feels good to play with friends" is higher than the bar for "technically accurate."

## Status

Early concept / pre-prototype. This document describes intended scope, not yet built functionality.
