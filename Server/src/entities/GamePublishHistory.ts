import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Game } from './Games';
import { User } from './User';

export enum GamePublishAction {
  PUBLISHED = 'published',
  UNPUBLISHED = 'unpublished',
}

@Entity('game_publish_history', { schema: 'internal' })
export class GamePublishHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  gameId: string;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;

  @Column({
    type: 'enum',
    enum: GamePublishAction,
  })
  action: GamePublishAction;

  @Column({ nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorId' })
  actor: User | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  actorRole: string | null;

  @CreateDateColumn()
  @Index()
  createdAt: Date;
}
