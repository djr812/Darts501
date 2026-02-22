# config.py
import os

class DevelopmentConfig:
    DEBUG = True
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    DB_HOST     = os.getenv("DB_HOST", "localhost")
    DB_PORT     = int(os.getenv("DB_PORT", 3306))
    DB_USER     = os.getenv("DB_USER", "darts_user")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "changeme")
    DB_NAME     = os.getenv("DB_NAME", "darts")

class ProductionConfig(DevelopmentConfig):
    DEBUG = False
    SECRET_KEY = os.getenv("SECRET_KEY")  # Must be set in environment — no default