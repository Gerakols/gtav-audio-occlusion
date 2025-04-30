import React from 'react';
import { FaTimes } from 'react-icons/fa';

import { isErr, unwrapResult } from '@/electron/common';

import { ProjectAPI } from '@/electron/common/types/project';

import { useProject } from '../../context';

import {
  Dialog,
  Portal,
  Overlay,
  Content,
  Header,
  Title,
  Close,
  Form,
  Group,
  Entry,
  Input,
  TextInput,
  FileInput,
  FilePath,
  SelectFileButton,
  CreateButton,
} from '../CreateModal/styles';

const { API } = window;

export const AddInteriorModal = (): JSX.Element => {
  const {
    addInterior,
    addInteriorModalState: state,
    setAddInteriorModalOpen,
    setAddInteriorModalInterior,
    setAddInteriorModalMapDataFile,
    setAddInteriorModalMapTypesFile,
  } = useProject();

  const selectMapData = async (): Promise<void> => {
    const result: Result<string, string> = await API.invoke(ProjectAPI.SELECT_MAP_DATA_FILE);

    if (isErr(result)) {
      return console.warn(unwrapResult(result));
    }

    setAddInteriorModalMapDataFile(unwrapResult(result));
  };

  const selectMapTypes = async (): Promise<void> => {
    const result: Result<string, string> = await API.invoke(ProjectAPI.SELECT_MAP_TYPES_FILE);

    if (isErr(result)) {
      return console.warn(unwrapResult(result));
    }

    setAddInteriorModalMapTypesFile(unwrapResult(result));
  };

  return (
    <Dialog open={state.open}>
      <Portal>
        <Overlay />
        <Content>
          <Header>
            <Title>Add new interior</Title>
            <Close onClick={() => setAddInteriorModalOpen(false)}>
              <FaTimes size={18} />
            </Close>
          </Header>
          <Form>
            <Group>
              <Entry>
                <label>Interior name:</label>
                <Input>
                  <TextInput
                    type="text"
                    placeholder="Interior name"
                    value={state.interior}
                    onChange={e => setAddInteriorModalInterior(e.target.value)}
                  />
                </Input>
              </Entry>
              <Entry>
                <label>#map path:</label>
                <Input>
                  <FileInput>
                    <FilePath>{state.mapDataFilePath}</FilePath>
                    <SelectFileButton type="button" onClick={selectMapData}>
                      Select file
                    </SelectFileButton>
                  </FileInput>
                </Input>
              </Entry>
              <Entry>
                <label>#typ path:</label>
                <Input>
                  <FileInput>
                    <FilePath>{state.mapTypesFilePath}</FilePath>
                    <SelectFileButton type="button" onClick={selectMapTypes}>
                      Select file
                    </SelectFileButton>
                  </FileInput>
                </Input>
              </Entry>
            </Group>
            <CreateButton type="button" onClick={addInterior}>
              Add interior
            </CreateButton>
          </Form>
        </Content>
      </Portal>
    </Dialog>
  );
};