# Use official Python 3.12 image
FROM python:3.12

# Set working directory
WORKDIR /code

# Copy requirements and install dependencies
COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# Copy the entire backend folder contents into the container
COPY . /code

# Expose port 80
EXPOSE 80

# Run the FastAPI app using uvicorn
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "80"]