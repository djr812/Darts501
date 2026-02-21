from sqlalchemy import Column, Integer, String, Enum, TIMESTAMP, ForeignKey, Boolean, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()

class Player(Base):
    __tablename__ = "players"
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    nickname = Column(String(50))
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())
    updated_at = Column(TIMESTAMP, server_default=func.current_timestamp(), onupdate=func.current_timestamp())
    is_active = Column(Boolean, default=True)

class Match(Base):
    __tablename__ = "matches"
    id = Column(Integer, primary_key=True)
    game_type = Column(Enum("501", "cricket"), nullable=False, server_default="501")
    start_time = Column(TIMESTAMP, server_default=func.current_timestamp())
    end_time = Column(TIMESTAMP)
    status = Column(Enum("active", "completed", "abandoned"), default="active")
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())
    updated_at = Column(TIMESTAMP, server_default=func.current_timestamp(), onupdate=func.current_timestamp())

class Leg(Base):
    __tablename__ = "legs"
    id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("matches.id", ondelete="CASCADE"), nullable=False)
    leg_number = Column(Integer, nullable=False)
    starting_player_id = Column(Integer, ForeignKey("players.id"))
    winning_player_id = Column(Integer, ForeignKey("players.id"))
    start_time = Column(TIMESTAMP, server_default=func.current_timestamp())
    end_time = Column(TIMESTAMP)
    status = Column(Enum("active", "completed"), default="active")
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())
    updated_at = Column(TIMESTAMP, server_default=func.current_timestamp(), onupdate=func.current_timestamp())

class Turn(Base):
    __tablename__ = "turns"
    id = Column(Integer, primary_key=True)
    leg_id = Column(Integer, ForeignKey("legs.id", ondelete="CASCADE"), nullable=False)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=False)
    turn_number = Column(Integer, nullable=False)
    score = Column(Integer, default=0)
    remaining_score = Column(Integer, nullable=False)
    darts_thrown = Column(Integer, default=0)
    is_bust = Column(Boolean, default=False)
    is_checkout = Column(Boolean, default=False)
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())

class Throw(Base):
    __tablename__ = "throws"
    id = Column(Integer, primary_key=True)
    turn_id = Column(Integer, ForeignKey("turns.id", ondelete="CASCADE"), nullable=False)
    dart_number = Column(Integer, nullable=False)
    segment = Column(Integer, nullable=False)
    multiplier = Column(Integer, nullable=False)
    points = Column(Integer, nullable=False)
    is_bust = Column(Boolean, default=False)
    is_checkout = Column(Boolean, default=False)
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())