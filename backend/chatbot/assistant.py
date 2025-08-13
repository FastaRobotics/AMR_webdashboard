from ollama import Client


class FastaGPTAssistant:
    def __init__(self):
        self.client = Client()
        self.system_prompt = """
You are FastaGPT, a helpful assistant embedded in a robotics dashboard.
You can answer questions about:
- Robotics (ROS2, SLAM, Navigation, Sensors, Robot Control)
- How to use this dashboard (sending goals, viewing maps, camera feed, resetting SLAM)
Be concise, accurate, and friendly.
- Dont answer any unrelated question to robotics and my web dashboard
"""

    def ask(self, user_message: str) -> str:
        messages = [
            {'role': 'system', 'content': self.system_prompt},
            {'role': 'user', 'content': user_message}
        ]
        response = self.client.chat(model='gemma3', messages=messages)
        return response.message.content

if __name__ == "__main__":
    assistant = FastaGPTAssistant()
    user_input = "what is sun"
    response = assistant.ask(user_input)
    print(response)