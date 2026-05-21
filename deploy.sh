#!/bin/bash

# ==========================================================================
# silky-bohr-burner: Automated Deployment Engine
# ==========================================================================

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

# Check if running on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo -e "${YELLOW}Warning: This script is optimised for Linux distributions.${NC}"
    echo -e "It seems you are running on: ${BOLD}$OSTYPE${NC}"
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

# Detect Package Manager (Debian/Ubuntu focus)
if [ -x "$(command -v apt-get)" ]; then
    echo -e "${CYAN}[1/4] Installing system dependencies (ffmpeg, wodim, cdparanoia, nodejs)...${NC}"
    echo -e "${YELLOW}Note: This requires sudo privileges. You may be prompted for your password.${NC}"
    
    sudo apt-get update
    sudo apt-get install -y nodejs npm ffmpeg wodim cdparanoia
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Error: Failed to install system packages. Please resolve manually and re-run.${NC}"
        exit 1
    fi
    echo -e "${GREEN}System packages successfully installed!${NC}"
else
    echo -e "${YELLOW}Warning: 'apt-get' package manager not found.${NC}"
    echo -e "Please ensure 'nodejs', 'npm', 'ffmpeg', and 'wodim' (or 'cdrecord') are installed manually."
fi

# CD-ROM Group Privileges Setup
echo -e "\n${CYAN}[2/4] Configuring CD Burner write privileges...${NC}"
if getent group cdrom > /dev/null; then
    echo -e "Adding user ${BOLD}$USER${NC} to group ${BOLD}cdrom${NC}..."
    sudo usermod -aG cdrom $USER
    echo -e "${GREEN}User added to cdrom group successfully!${NC}"
    echo -e "${YELLOW}Note: Group changes will apply immediately to services, but interactive shells require re-login or running 'newgrp cdrom'.${NC}"
else
    echo -e "${YELLOW}Warning: 'cdrom' group not found on this system. Optical drives might require manual permission adjustments.${NC}"
fi

# Node Dependencies Setup
echo -e "\n${CYAN}[3/4] Installing web application NPM dependencies...${NC}"
npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to install Node dependencies.${NC}"
    exit 1
fi
echo -e "${GREEN}NPM dependencies installed successfully!${NC}"

# Optional Systemd Daemon Configuration
echo -e "\n${CYAN}[4/4] Configuring execution environment...${NC}"
echo -e "Would you like to install silky-bohr-burner as a ${BOLD}Systemd background service${NC}?"
echo -e "This allows the CD engine to start automatically when the server boots up and restarts it on crashes."
read -p "Install Systemd service? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    SERVICE_FILE="/etc/systemd/system/silky-burner.service"
    WORKING_DIR=$(pwd)
    
    echo -e "Creating systemd service file at ${BOLD}$SERVICE_FILE${NC}..."
    
    # Generate systemd config
    sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=silky-bohr-burner CD Mastering Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$WORKING_DIR
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=NODE_ENV=production PORT=3000

[Install]
WantedBy=multi-user.target
EOF

    echo -e "Reloading systemd manager configuration..."
    sudo systemctl daemon-reload
    
    echo -e "Enabling silky-burner service to run on boot..."
    sudo systemctl enable silky-burner.service
    
    echo -e "Starting silky-burner service..."
    sudo systemctl start silky-burner.service
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}${BOLD}Service installed and active!${NC}"
        echo -e "You can manage the service using the following commands:"
        echo -e "  - View status:  ${CYAN}sudo systemctl status silky-burner.service${NC}"
        echo -e "  - View logs:    ${CYAN}journalctl -u silky-burner.service -f${NC}"
        echo -e "  - Restart:      ${CYAN}sudo systemctl restart silky-burner.service${NC}"
    else
        echo -e "${RED}Error: Failed to start Systemd service. Checking status...${NC}"
        sudo systemctl status silky-burner.service
    fi
else
    echo -e "${YELLOW}Skipped Systemd service installation.${NC}"
    echo -e "You can run the web server manually at any time by running:"
    echo -e "  ${BOLD}npm start${NC}"
fi

# Print Success Banner
SERVER_IP=$(hostname -I | awk '{print $1}')
if [ -z "$SERVER_IP" ]; then
    SERVER_IP="your-server-ip"
fi

echo -e "\n${GREEN}${BOLD}==========================================================${NC}"
echo -e "${GREEN}${BOLD}    DEPLOYMENT COMPLETE! silky-bohr-burner is ready!     ${NC}"
echo -e "${GREEN}${BOLD}==========================================================${NC}"
echo -e "Your daughter can now access the CD burning interface at:"
echo -e "  👉  ${CYAN}${BOLD}http://${SERVER_IP}:3000${NC}"
echo -e "=========================================================="
