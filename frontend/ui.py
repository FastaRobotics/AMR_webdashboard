import streamlit as st
import streamlit.components.v1 as components

components.iframe(
    "http://5.78.129.249:8080/?ds=rosbridge-websocket&ds.url=ws://5.78.129.249:9090",
    width=800,
    height=600
)
