import streamlit as st
import requests
import base64
import json

API_URL = "http://localhost:8000"

st.title("User Dashboard")

auth_header = st.session_state.get("auth", "")

# -----------------------------
# CREATE USER
# -----------------------------
st.header("Create User")

id = st.number_input("ID", step=1)
first = st.text_input("First Name")
last = st.text_input("Last Name")
email = st.text_input("Email")
username = st.text_input("Username")
password = st.text_input("Password", type="password")

if st.button("Create User"):

    data = {
        "id": int(id),
        "first_name": first,
        "last_name": last,
        "email": email,
        "user_name": username,
        "password": password
    }

    r = requests.post(f"{API_URL}/user/create", json=data)

    st.json(r.json())

# -----------------------------
# LOGIN
# -----------------------------
st.header("Login")

login_user = st.text_input("Login Username")
login_pass = st.text_input("Login Password", type="password")

if st.button("Login"):

    auth = base64.b64encode(f"{login_user}:{login_pass}".encode()).decode()
    st.session_state.auth = f"Basic {auth}"

    st.success(f"Logged in as {login_user}")

# -----------------------------
# GET USER
# -----------------------------
st.header("Get User")

user_id = st.number_input("User ID", step=1, key="get_user")

if st.button("Get User Info"):

    headers = {"Authorization": st.session_state.get("auth","")}

    r = requests.get(
        f"{API_URL}/user/{user_id}",
        headers=headers
    )

    try:
        st.json(r.json())
    except:
        st.write(r.text)