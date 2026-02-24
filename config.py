# config.py
import os

class DevelopmentConfig:
    DEBUG = True
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    DB_HOST     = os.getenv("DB_HOST", "10.1.1.126")
    DB_PORT     = int(os.getenv("DB_PORT", 3306))
    DB_USER     = os.getenv("DB_USER", "darts_user")
    DB_PASSWORD = os.getenv("DB_PASSWORD")
    DB_NAME     = os.getenv("DB_NAME", "darts")
    OLLAMA_URL   = "http://10.1.1.126:11434"   
    OLLAMA_MODEL            = "llama3.1:8b"
    OLLAMA_NUM_PREDICT_FULL = 1200   # mistral-nemo is more verbose
    OLLAMA_NUM_PREDICT_TIPS = 600

class ProductionConfig(DevelopmentConfig):
    DEBUG = False
    SECRET_KEY = os.getenv("SECRET_KEY")  # Must be set in environment — no default