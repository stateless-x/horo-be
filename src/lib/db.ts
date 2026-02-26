import { createDbClient } from '../../lib/db';
import { config } from '../config';

export const db = createDbClient(config.database.url);
