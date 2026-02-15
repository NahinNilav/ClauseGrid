#!/bin/bash

cd "$(dirname "$0")"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install/update dependencies
echo "Installing dependencies (this may take a few minutes on first run)..."
pip install -r requirements.txt

# Start the server
echo ""
echo "Starting backend server..."
echo "Parser safety settings:"
echo "  LEGAL_PARSE_MAX_CONCURRENCY=${LEGAL_PARSE_MAX_CONCURRENCY:-1}"
echo "  LEGAL_PDF_DOCLING_MODE=${LEGAL_PDF_DOCLING_MODE:-auto}"
echo "API available at: http://localhost:8000"
echo "API docs at: http://localhost:8000/docs"
echo ""
python app.py
