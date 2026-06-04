export class AuditLogEvent {
  action: string;
  actorId?: string;
  targetId: string;
  targetType: 'USER' | 'PRODUCT' | 'PRODUCT_VARIANT' | 'ORDER';
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;

  constructor(data: {
    action: string;
    actorId?: string;
    targetId: string;
    targetType: 'USER' | 'PRODUCT' | 'PRODUCT_VARIANT' | 'ORDER';
    oldValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
  }) {
    this.action = data.action;
    this.actorId = data.actorId;
    this.targetId = data.targetId;
    this.targetType = data.targetType;
    this.oldValues = data.oldValues ? this.sanitize(data.oldValues) : null;
    this.newValues = data.newValues ? this.sanitize(data.newValues) : null;
  }

  private sanitize(payload: Record<string, unknown>): Record<string, unknown> {
    const safePayload = { ...payload };
    const forbiddenKeys = [
      'password',
      'refreshTokens',
      'passwordResetToken',
      'emailVerificationToken',
    ];

    for (const key of forbiddenKeys) {
      if (key in safePayload) delete safePayload[key];
    }

    return safePayload;
  }
}
