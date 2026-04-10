import enum
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import JSON, Column, DateTime, String
from sqlmodel import Field, SQLModel


class GameStatus(str, enum.Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class GameProcessingStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class GameProposalStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DECLINED = "declined"
    SUPERSEDED = "superseded"


class GameProposalType(str, enum.Enum):
    CREATE = "create"
    UPDATE = "update"


class Game(SQLModel, table=True):
    __tablename__ = "games"

    id: str = Field(primary_key=True)
    title: str
    slug: str
    description: Optional[str] = None
    thumbnailFileId: Optional[str] = Field(default=None)
    status: GameStatus = Field(default=GameStatus.ACTIVE)
    gameFileId: Optional[str] = Field(default=None)
    config: int = Field(default=0)
    baseLikeCount: int = Field(default=100)
    lastLikeIncrement: datetime = Field(default_factory=datetime.utcnow)
    categoryId: Optional[str] = Field(default=None)
    createdById: Optional[str] = Field(default=None)
    position: Optional[int] = None
    processingStatus: GameProcessingStatus = Field(default=GameProcessingStatus.COMPLETED)
    processingError: Optional[str] = None
    jobId: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)


class GameProposal(SQLModel, table=True):
    __tablename__ = "game_proposals"

    id: str = Field(primary_key=True)
    type: GameProposalType = Field(default=GameProposalType.UPDATE)
    gameId: Optional[str] = Field(default=None)
    editorId: str
    status: GameProposalStatus = Field(default=GameProposalStatus.PENDING)
    previousProposalId: Optional[str] = None
    proposedData: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    adminFeedback: Optional[str] = None
    reviewedBy: Optional[str] = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)
    feedbackDismissedAt: Optional[datetime] = None
