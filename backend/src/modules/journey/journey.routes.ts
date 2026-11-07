import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import { buildJourney } from '../../services/journey.service';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
router.use(authenticate);

/** The caller's open work, step by step, and who each piece is waiting on. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await buildJourney(currentUser(req)));
  }),
);

export default router;
