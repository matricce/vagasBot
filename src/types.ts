import { Keyboard } from 'grammy';
import { Browser } from 'puppeteer';

type Search = {
  jobRole: string;
  blacklisted: string[];
  datePosted: number;
  revoke: boolean;
  inProgress: string;
  ETA: number;
  reset: () => void;
  keyboard: Keyboard;
  browser?: Browser;
};

export { Search };
