import { Body, Controller, Post } from '@nestjs/common';
import { EmailService } from './email.service';
import { Throttle } from '@nestjs/throttler';
import { ContactDto } from './dto/contact.dto';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Throttle({ default: { limit: 3, ttl: 600000 } }) // Limit to 3 requests per 10 minutes
  @Post()
  async submitContactForm(@Body() contactDto: ContactDto) {
    await this.emailService.sendContactSupportEmail(
      contactDto.fullName,
      contactDto.email,
      contactDto.message,
    );
    return { success: true };
  }
}
