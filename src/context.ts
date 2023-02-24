import { createContext } from 'react';

import { ROOT_FOCUS_KEY } from './constants';

const FocusContext = createContext(ROOT_FOCUS_KEY);

export default FocusContext;
