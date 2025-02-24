# Use an official lightweight Python image
FROM python:3.10-slim

# Create a directory for your app
WORKDIR /app

# Copy requirements into container
COPY requirements.txt /app

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your code
COPY . /app

# Default command to run the app with uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
