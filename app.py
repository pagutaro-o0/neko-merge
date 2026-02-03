from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# 超ミニ：スコア保存（メモリ。永続化したければDB/Redisへ）
BEST = {"score": 0}

@app.get("/")
def index():
    return render_template("index.html")

@app.get("/api/best")
def get_best():
    return jsonify(BEST)

@app.post("/api/best")
def post_best():
    data = request.get_json(force=True)
    score = int(data.get("score", 0))
    if score > BEST["score"]:
        BEST["score"] = score
    return jsonify(BEST)

if __name__ == "__main__":
    app.run()