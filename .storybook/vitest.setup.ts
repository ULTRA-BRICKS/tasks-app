import { beforeAll } from 'vitest';
import { setProjectAnnotations } from '@storybook/react-vite';
import * as annotations from './preview';
const project = setProjectAnnotations([annotations]);
beforeAll(project.beforeAll);
