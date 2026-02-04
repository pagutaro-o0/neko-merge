from flask import Flask, render_template, request, jsonify
import os

app = Flask(__name__)

BEST = {"score": 0}

@app.get("/")
def index():
    return render_template("index.html")

@app.get("/api/best")
def get_best():
    return jsonify(BEST)

@app.post("/api/best")
def post_best():
    data = request.get_json(force=True, silent=True) or {}
    score = int(data.get("score", 0))
    if score > BEST["score"]:
        BEST["score"] = score
    return jsonify(BEST)

if __name__ == "__main__":
    # Macで 5000 が AirTunes に取られることがあるのでデフォルト5050
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port, debug=True)