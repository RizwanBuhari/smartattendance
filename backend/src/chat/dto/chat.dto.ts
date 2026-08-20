// Swagger schemas for the dashboard assistant.
//
// Same split as attendance/dto: these classes exist so the generated OpenAPI
// document (and the "Try it out" box on /api/docs) has a real request body
// instead of `object`. Runtime checks stay in the controller — an inline
// TypeScript type is erased at compile time, so Swagger cannot see it and
// renders no body field at all, which is exactly the trap this file closes.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatAskDto {
  @ApiProperty({
    example: 'Which locations are set up, and what are their radii?',
    maxLength: 1000,
    description:
      'The administrator\'s question, in plain English. The assistant answers ' +
      'by calling read-only internal tools over the attendance and locations ' +
      'services — it has no direct database access and cannot modify anything.',
  })
  message: string;
}

export class ChatAnswerDto {
  @ApiProperty({
    example:
      'There are two approved locations: Dubai Office (100 m radius) and ' +
      'Jebel Ali Site (250 m radius).',
    description:
      'The assistant\'s reply. Always a 200 with prose — including when the ' +
      'assistant cannot answer, so the client renders the explanation rather ' +
      'than an error state.',
  })
  answer: string;

  @ApiPropertyOptional({
    example: ['listLocations'],
    description:
      'Which tools the model called to produce this answer. Useful when ' +
      'checking that a reply came from real data rather than the prompt.',
  })
  toolsUsed?: string[];
}
