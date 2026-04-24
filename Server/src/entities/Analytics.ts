import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { User } from './User';
import { Game } from './Games';
import {
  IsInt,
  Min,
  ValidateIf,
  MaxLength,
  validateOrReject,
} from 'class-validator';

@Entity('analytics', { schema: 'internal' })
@Index(['userId', 'activityType'])
@Index(['gameId', 'startTime'])
@Index(['userId', 'startTime'])
@Index(['activityType', 'startTime'])
@Index(['userId', 'gameId'])
// Composite indexes for optimized queries (new)
@Index(['createdAt', 'userId', 'sessionId', 'duration']) // For unified user counting with COALESCE
@Index(['createdAt', 'gameId', 'duration'])              // For game session queries
@Index(['createdAt', 'duration'])                        // For time-range filtered queries
export class Analytics {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', nullable: true })
  @Index()
  userId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ name: 'session_id', type: 'varchar', length: 255, nullable: true })
  @Index()
  sessionId: string | null;

  @Column({ name: 'country', type: 'varchar', length: 100, nullable: true })
  @Index()
  country: string | null;

  @Column({ name: 'game_id', nullable: true })
  @Index()
  gameId: string | null;

  @ManyToOne(() => Game, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'game_id' })
  game: Game;

  @Column({ type: 'varchar', length: 50 })
  @Index()
  activityType: string;

  @Column({ type: 'timestamp', nullable: true })
  @Index()
  startTime: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  @Index()
  endTime: Date;

  @Column({ type: 'int', nullable: true })
  @Index()
  @ValidateIf((o) => o.duration !== null && o.duration !== undefined)
  @IsInt()
  @Min(0)
  duration: number | null; // Duration in seconds

  @Column({ type: 'int', nullable: true, default: null })
  sessionCount: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  @Index()
  @MaxLength(50)
  exitReason: string | null;

  @Column({ type: 'int', nullable: true })
  @ValidateIf((o) => o.loadTime !== null && o.loadTime !== undefined)
  @IsInt()
  @Min(0)
  loadTime: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  @MaxLength(50)
  milestone: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  @Index()
  lastSeenAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  @Index()
  endedAt: Date | null;

  // Soft-delete marker for game sessions that ended with duration < 30s. Replaces
  // the previous hard-delete on /end so we keep the row for audit and product
  // signal (quick-bounce patterns, broken games) while still excluding it from
  // dashboard aggregations. Only Total Visitors needs an explicit filter; every
  // other dashboard query already requires duration >= 30 and so excludes these
  // implicitly.
  @Column({ name: 'is_discarded', type: 'boolean', default: false })
  @Index()
  isDiscarded: boolean;

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  async validate() {
    // Auto-calculate duration when both times exist (Part 1: Entity Hook)
    // This ensures duration is ALWAYS calculated automatically on every save
    if (this.startTime && this.endTime) {
      const calculatedDuration = Math.floor(
        (this.endTime.getTime() - this.startTime.getTime()) / 1000
      );
      // Always set the calculated duration
      this.duration = calculatedDuration;
    }

    // Semantic checks - Invariants ONLY
    if (this.startTime && this.endedAt) {
      if (this.endedAt < this.startTime) {
        throw new Error('endedAt cannot be before startTime');
      }
    }

    await validateOrReject(this, { skipMissingProperties: true });
  }
}
