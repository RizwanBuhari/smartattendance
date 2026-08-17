// POST /chat — the dashboard assistant's single endpoint.
//
// Behind AdminGuard, like every other dashboard route. Two separate reasons it
// cannot be left open: attendance data is not public, and an unauthenticated
// endpoint that calls a paid model is a billing incident waiting for anyone who
// finds the URL.
import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../auth/admin.guard';
import { ChatService } from './chat.service';
import { ChatAnswerDto, ChatAskDto } from './dto/chat.dto';

// Keeps a pasted log file or a runaway client from becoming a large bill.
const MAX_MESSAGE_LENGTH = 1000;

@ApiTags('chat')
@Controller('chat')
@UseGuards(AdminGuard)
@ApiBearerAuth('firebase')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @ApiOperation({
    summary: 'Ask the dashboard assistant a question about attendance data',
    description:
      'Read-only. The model answers by calling internal tools over the ' +
      'attendance and locations services — it has no direct database access, ' +
      'and cannot modify anything.\n\n' +
      'Requires an admin: the caller must hold a valid Firebase ID token AND ' +
      'be listed in `admin_Users`.',
  })
  // @ApiBody is what puts an editable request box on /api/docs. Without it the
  // "Try it out" button sends an empty body and the route answers 400.
  @ApiBody({ type: ChatAskDto })
  @ApiOkResponse({ type: ChatAnswerDto })
  async ask(@Body() body: ChatAskDto, @Req() req: { adminEmail?: string }) {
    const message = (body?.message ?? '').trim();

    if (!message) {
      throw new BadRequestException('A message is required.');
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Message too long (${message.length} characters, limit ${MAX_MESSAGE_LENGTH}).`,
      );
    }

    // AdminGuard put this here after verifying the token. Taking it from the
    // request — never from the body — is the same rule the rest of the API
    // follows.
    return this.chat.ask(message, req.adminEmail ?? 'unknown');
  }
}
