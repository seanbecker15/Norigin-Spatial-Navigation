import { useContext } from 'react';

import FocusContext from '../context';

/** @internal */
const useFocusContext = () => useContext(FocusContext);

export default useFocusContext;
