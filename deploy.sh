#!/bin/bash

# ==========================================================================
# silky-bohr-burner: Automated Deployment Engine
# ==========================================================================

set -e

# Text colours & styling
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Colour
BOLD='\033[1m'

echo -e "${CYAN}${BOLD}"
echo "=========================================================="
echo "    silky-bohr-burner : HOME SERVER DEPLOYMENT ENGINE     "
echo "=========================================================="
echo -e "${NC}"

# -- Pre-flight checks -------------------------------------------------------

# Check if running on Linux
if [[ "${OSTYPE:-}" != "linux-gnu"* ]]; then
    echo -e "${YELLOW}Warning: This script is optimised for Linux distributions.${NC}"
    echo -e "It seems you are running on: ${BOLD}${OSTYPE:-unknown}${NC}"
    echo -e "We will attempt to install Node dependencies, but system package installation will be skipped."
    echo ""
    read -p "Do you want to continue with Node dependency installation? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Deployment aborted by user.${NC}"
        exit 1
    fi

    echo -e "${CYAN}Installing local Node dependencies...${NC}"
    npm install
    echo -e "${GREEN}Dependencies installed. Start the server using 'npm start'.${NC}"
    exit 0
fi

# Sudo capability check
echo -e "${CYAN}[Check] Verifying sudo access...${NC}"
SUDO_PREFIX=""
SUDO_READY=false
HAS_TTY=false

if [ -t 1 ]; then
    HAS_TTY=true
fi

if command -v sudo &>/dev/null; then
    if sudo -n true 2>/dev/null; then
        SUDO_READY=true
        SUDO_PREFIX="sudo"
        echo -e "${GREEN}Passwordless sudo is available.${NC}"
    elif [ -n "${SUDO_ASKPASS:-}" ]; then
        SUDO_READY=true
        SUDO_PREFIX="sudo -A"
        echo -e "${GREEN}Using SUDO_ASKPASS for authentication.${NC}"
    elif command -v ssh-askpass &>/dev/null; then
        SUDO_READY=true
        SUDO_PREFIX="sudo -A"
        export SUDO_ASKPASS=$(command -v ssh-askpass)
        echo -e "${GREEN}Using ssh-askpass for sudo.${NC}"
    elif [ "$HAS_TTY" = true ]; then
        SUDO_READY=true
        SUDO_PREFIX="sudo"
        echo -e "${GREEN}Interactive sudo available (TTY detected).${NC}"
    else
        echo -e "${YELLOW}No passwordless sudo and no TTY available.${NC}"
        # Check if we have a real TTY for password prompt
        SUDO_TTY_OK=false
        { [ -e /dev/tty ] && sudo -S true </dev/tty; } 2>/dev/null && SUDO_TTY_OK=true || true
        if [ "$SUDO_TTY_OK" = true ]; then
            SUDO_READY=true
            SUDO_PREFIX="sudo -S"
            echo -e "${GREEN}Sudo with stdin prompt works.${NC}"
        else
            echo -e "  (no TTY available for password prompt)"
        fi
    fi
fi

if [ "$SUDO_READY" = false ]; then
    echo -e "${YELLOW}Sudo is not available in the current non-interactive context.${NC}"
    echo -e "You can still complete deployment by running these steps manually:"
    echo -e ""
    echo -e "  ${CYAN}1. sudo apt-get install -y wodim cdparanoia${NC}"
    echo -e "  ${CYAN}2. npm install${NC}"
    echo -e "  ${CYAN}3. npm start${NC}"
    echo -e ""
    echo -e "Or re-run this script in an interactive terminal, or configure"
    echo -e "passwordless sudo, or set the ${BOLD}SUDO_ASKPASS${NC} environment variable."
    echo -e ""
    read -p "Continue without system packages? (npm install still works) (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Deployment aborted by user.${NC}"
        exit 1
    fi
    APT_AVAILABLE=false
fi

# Auto-detect APT if sudo is ready and we haven't already set APT_AVAILABLE
if [ -z "${APT_AVAILABLE:-}" ]; then
    APT_AVAILABLE=false
    if command -v apt-get &>/dev/null; then
        APT_AVAILABLE=true
    fi
fi

# -- System dependency installation ------------------------------------------

if [ "$APT_AVAILABLE" = true ]; then
    echo -e "\n${CYAN}[1/4] Installing system dependencies...${NC}"

    # Determine which packages are actually needed
    NEEDED=""
    MISSING=false

    if ! command -v wodim &>/dev/null && ! command -v cdrecord &>/dev/null; then
        NEEDED="$NEEDED wodim"
        MISSING=true
    fi

    if ! command -v cdparanoia &>/dev/null; then
        NEEDED="$NEEDED cdparanoia"
        MISSING=true
    fi

    # nodejs & npm — only install via apt if NOT already present
    if ! command -v node &>/dev/null; then
        NEEDED="$NEEDED nodejs"
        MISSING=true
    fi
    if ! command -v npm &>/dev/null; then
        NEEDED="$NEEDED npm"
        MISSING=true
    fi

    # ffmpeg — only install via apt if NOT already present
    if ! command -v ffmpeg &>/dev/null; then
        NEEDED="$NEEDED ffmpeg"
        MISSING=true
    fi

    if [ "$MISSING" = true ]; then
        echo -e "The following packages will be installed:${CYAN}$NEEDED${NC}"
        echo -e "${YELLOW}Note: This requires sudo privileges. You may be prompted for your password.${NC}"

        $SUDO_PREFIX apt-get update -qq
        # shellcheck disable=SC2086
        $SUDO_PREFIX apt-get install -y $NEEDED

        echo -e "${GREEN}System packages successfully installed!${NC}"
    else
        echo -e "${GREEN}All required system packages are already installed.${NC}"
    fi
else
    echo -e "${YELLOW}Skipping system package installation (apt-get not available or no sudo access).${NC}"
    echo -e "Please ensure the following are installed manually:"
    echo -e "  - wodim (or cdrecord)  — ${CYAN}sudo apt-get install -y wodim${NC}"
    echo -e "  - cdparanoia           — ${CYAN}sudo apt-get install -y cdparanoia${NC}"
fi

# -- CD-ROM Group Privileges Setup -------------------------------------------

echo -e "\n${CYAN}[2/4] Configuring CD Burner write privileges...${NC}"
if getent group cdrom > /dev/null; then
    if groups "$USER" | grep -q '\bcdrom\b'; then
        echo -e "${GREEN}User ${BOLD}$USER${NC}${GREEN} is already in the cdrom group.${NC}"
    else
        echo -e "Adding user ${BOLD}$USER${NC} to group ${BOLD}cdrom${NC}..."
        $SUDO_PREFIX usermod -aG cdrom "$USER"
        echo -e "${GREEN}User added to cdrom group successfully!${NC}"
        echo -e "${YELLOW}Note: Group changes will apply immediately to services, but interactive shells require re-login or running 'newgrp cdrom'.${NC}"
    fi
else
    echo -e "${YELLOW}Warning: 'cdrom' group not found on this system. Optical drives might require manual permission adjustments.${NC}"
fi

# -- Node Dependencies Setup -------------------------------------------------

echo -e "\n${CYAN}[3/4] Installing web application dependencies...${NC}"

echo -e "Installing Node packages..."
npm install
echo -e "${GREEN}NPM dependencies installed successfully!${NC}"

# Spotify downloader (spotdl)
if ! command -v spotdl &>/dev/null; then
    echo -e "Installing spotdl (Spotify downloader)..."
    if pip3 install spotdl --break-system-packages; then
        echo -e "${GREEN}spotdl installed successfully!${NC}"
    else
        echo -e "${YELLOW}Warning: spotdl installation failed. Spotify download feature will not be available.${NC}"
        echo -e "  To install manually: ${CYAN}pip3 install spotdl --break-system-packages${NC}"
    fi
else
    echo -e "${GREEN}spotdl is already installed.${NC}"
fi

# -- Optional Systemd Daemon Configuration -----------------------------------

echo -e "\n${CYAN}[4/4] Configuring execution environment...${NC}"
echo -e "Would you like to install silky-bohr-burner as a ${BOLD}Systemd background service${NC}?"
echo -e "This allows the CD engine to start automatically when the server boots up and restarts it on crashes."
read -p "Install Systemd service? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    SERVICE_FILE="/etc/systemd/system/silky-burner.service"
    WORKING_DIR=$(pwd)

    echo -e "Creating systemd service file at ${BOLD}$SERVICE_FILE${NC}..."

    $SUDO_PREFIX tee "$SERVICE_FILE" > /dev/null <<SERVICEEOF
[Unit]
Description=silky-bohr-burner CD Mastering Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$WORKING_DIR
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
SERVICEEOF

    echo -e "Reloading systemd manager configuration..."
    $SUDO_PREFIX systemctl daemon-reload

    echo -e "Enabling silky-burner service to run on boot..."
    $SUDO_PREFIX systemctl enable silky-burner.service

    echo -e "Starting silky-burner service..."
    if $SUDO_PREFIX systemctl start silky-burner.service; then
        echo -e "${GREEN}${BOLD}Service installed and active!${NC}"
        echo -e "You can manage the service using the following commands:"
        echo -e "  - View status:  ${CYAN}sudo systemctl status silky-burner.service${NC}"
        echo -e "  - View logs:    ${CYAN}journalctl -u silky-burner.service -f${NC}"
        echo -e "  - Restart:      ${CYAN}sudo systemctl restart silky-burner.service${NC}"
    else
        echo -e "${RED}Error: Failed to start Systemd service. Checking status...${NC}"
        $SUDO_PREFIX systemctl status silky-burner.service --no-pager || true
    fi
else
    echo -e "${YELLOW}Skipped Systemd service installation.${NC}"
    echo -e "You can run the web server manually at any time by running:"
    echo -e "  ${BOLD}npm start${NC}"
fi

# -- Print Success Banner ----------------------------------------------------

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$SERVER_IP" ]; then
    SERVER_IP="your-server-ip"
fi

echo -e "\n${GREEN}${BOLD}==========================================================${NC}"
echo -e "${GREEN}${BOLD}    DEPLOYMENT COMPLETE! silky-bohr-burner is ready!     ${NC}"
echo -e "${GREEN}${BOLD}==========================================================${NC}"
echo -e "Your daughter can now access the CD burning interface at:"
echo -e "  👉  ${CYAN}${BOLD}http://${SERVER_IP}:3000${NC}"
echo -e "=========================================================="
