import { Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';

interface LoginBody {
  identifier?: string;
}

@Injectable()
export class LoginLimitGuard extends ThrottlerGuard {
  // Track attempts per identifier + IP
  protected getTrack(req: Record<string, unknown>): string {
    const body = req['body'] as LoginBody | undefined;
    const identifier =
      typeof body?.identifier === 'string' && body.identifier.trim() !== ''
        ? body.identifier.toLowerCase()
        : 'anonymous';

    // Get client IP
    const ip = (req['ip'] as string) ?? 'unknown';
    return `login-${identifier}-${ip}`;
  }

  protected getLimit(): number {
    return 5; // 5 attempts
  }
  protected getTTL(): number {
    return 300_000; // 5 minutes
  }

  protected throwThrottlingException(): Promise<void> {
    throw new ThrottlerException(
      'Too many login attempts. Please try again later.',
    );
  }
}
