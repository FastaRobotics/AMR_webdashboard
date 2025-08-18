from ollama import Client
import chromadb
from sentence_transformers import SentenceTransformer


class FastaGPTAssistant:
    def __init__(self):
        self.client = Client()
        self.system_prompt = """
            You are FastaGPT, a helpful assistant embedded in a robotics dashboard.
            You can answer questions about:
            - How to operate the dashboard (connecting robots, sending goals, mapping, exploration, viewing camera/odom/TF).
            - General robot operation at the operator level.
            Do not answer unrelated questions (like weather, history, etc).
            Be concise, accurate, and friendly.
            """
        # --- Load Vector DB (operator docs already added) ---
        self.db = chromadb.PersistentClient(path="db/")
        self.collection = self.db.get_collection("robotics_docs")

        # Embedding model
        self.embedder = SentenceTransformer("all-MiniLM-L6-v2")

    def ask(self, user_message: str) -> str:
        # Step 1: Create embedding for query
        query_embedding = self.embedder.encode([user_message]).tolist()[0]

        # Step 2: Retrieve top docs
        results = self.collection.query(query_embeddings=[query_embedding], n_results=3)
        retrieved_docs = results["documents"][0] if results["documents"] else []

        # Step 3: Build context
        context = "\n".join(retrieved_docs) if retrieved_docs else "No relevant docs found."

        # Step 4: Send to LLM
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {user_message}"}
        ]

        try:
            response = self.client.chat(model="gemma3", messages=messages, options={"temperature": 0.2, "max_tokens": 300})
            return response.message.content.strip()
        except Exception as e:
            return f"Error calling model: {str(e)}"


# if __name__ == "__main__":
#     assistant = FastaGPTAssistant()

#     # Example: unrelated question
#     print("Q: what is sun")
#     print("A:", assistant.ask("what is sun"))

#     # Example: operator question
#     print("\nQ: how do I start mapping?")
#     print("A:", assistant.ask("how do I start mapping?"))

#     print("\nQ: whats your name?")
#     print("A:", assistant.ask("whats your name?"))
