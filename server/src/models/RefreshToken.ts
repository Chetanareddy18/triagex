import { Schema, model, type Types } from 'mongoose';

export interface IRefreshToken {
  user: Types.ObjectId;
  jti: string;
  family: string;
  expiresAt: Date;
  revokedAt?: Date;
  replacedBy?: string;
  userAgent?: string;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedBy: String,
    userAgent: String,
  },
  { timestamps: true },
);

// Expired tokens are removed by MongoDB's TTL monitor.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<IRefreshToken>('RefreshToken', refreshTokenSchema);
