import { Schema, model } from 'mongoose';

export interface IAuditLog {
  seq: number;
  action: string;
  actor: string; // user id or "system"
  actorName: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string; // ISO string, hashed exactly as stored
  prevHash: string;
  hash: string;
}

const auditSchema = new Schema<IAuditLog>(
  {
    seq: { type: Number, required: true, unique: true },
    action: { type: String, required: true, index: true },
    actor: { type: String, required: true },
    actorName: { type: String, default: '' },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: String, required: true },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { versionKey: false, minimize: false },
);

// Append-only at the application layer: any attempt to modify through Mongoose fails.
// (Direct database writes are what the hash chain is designed to detect.)
const reject = function () {
  throw new Error('audit log is append-only');
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  auditSchema.pre(op, reject);
}

auditSchema.set('toJSON', {
  transform: (_d: unknown, ret: object) => {
    delete (ret as Record<string, unknown>)._id;
    return ret;
  },
});

export const AuditLog = model<IAuditLog>('AuditLog', auditSchema);

// Signed checkpoints of the chain head. Rewriting the whole chain after the fact
// would also require the HMAC key to forge matching checkpoints.
export interface IAuditCheckpoint {
  seq: number;
  hash: string;
  signature: string;
  createdAt: Date;
  createdBy: string;
}

const checkpointSchema = new Schema<IAuditCheckpoint>(
  {
    seq: { type: Number, required: true, index: true },
    hash: { type: String, required: true },
    signature: { type: String, required: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
export const AuditCheckpoint = model<IAuditCheckpoint>('AuditCheckpoint', checkpointSchema);
