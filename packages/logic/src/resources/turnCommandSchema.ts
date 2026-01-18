import { z } from 'zod';

export const TurnCommandProfileInputSchema = z.object({
    general: z.array(z.string()),
    nation: z.array(z.string()),
});

export type TurnCommandProfileInput = z.infer<typeof TurnCommandProfileInputSchema>;
