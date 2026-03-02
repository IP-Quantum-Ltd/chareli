import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './User';
import { Game } from './Games';

export enum GameProposalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  DECLINED = 'declined',
  SUPERSEDED = 'superseded',
}

export enum GameProposalType {
  CREATE = 'create',
  UPDATE = 'update',
}

@Entity('game_proposals')
export class GameProposal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: GameProposalType,
    default: GameProposalType.UPDATE,
  })
  type: GameProposalType;

  @Column({ nullable: true })
  gameId: string;

  @ManyToOne(() => Game, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'gameId' })
  game: Game;

  @Column()
  @Index()
  editorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'editorId' })
  editor: User;

  @Column({
    type: 'enum',
    enum: GameProposalStatus,
    default: GameProposalStatus.PENDING,
  })
  @Index()
  status: GameProposalStatus;

  // Link to previous proposal for revision history
  @Column({ nullable: true })
  previousProposalId: string | null;

  @ManyToOne(() => GameProposal, { nullable: true })
  @JoinColumn({ name: 'previousProposalId' })
  previousProposal: GameProposal;

  @Column({ type: 'jsonb' })
  proposedData: any;

  @Column({ type: 'text', nullable: true })
  adminFeedback: string;

  @Column({ nullable: true })
  reviewedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewedBy' })
  reviewer: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  feedbackDismissedAt: Date | null;
}
