import React, { useEffect, useRef, useState, forwardRef } from 'react';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import toast from 'react-hot-toast';
import { useDispatch, useSelector } from 'react-redux';
import Portal from 'components/Portal';
import Modal from 'components/Modal';
import Dropdown from 'components/Dropdown';
import PathDisplay from 'components/PathDisplay';
import Help from 'components/Help';
import { newDocPage } from 'providers/ReduxStore/slices/collections/actions';
import { sanitizeName, validateName, validateNameError } from 'utils/common/regex';
import { IconArrowBackUp, IconCaretDown, IconEdit } from '@tabler/icons';
import StyledWrapper from 'components/Sidebar/NewRequest/StyledWrapper';
import Button from 'ui/Button';

const defaultDocContent = (name) => `# ${name || 'Untitled Doc'}

## Overview

`;

const NewDocPage = ({ collectionUid, item, onClose }) => {
  const dispatch = useDispatch();
  const inputRef = useRef();
  const collection = useSelector((state) => state.collections.collections?.find((c) => c.uid === collectionUid));
  const [isEditing, toggleEditing] = useState(false);
  const [showFilesystemName, toggleShowFilesystemName] = useState(false);
  const dropdownTippyRef = useRef();
  const onDropdownCreate = (ref) => (dropdownTippyRef.current = ref);

  const formik = useFormik({
    enableReinitialize: true,
    initialValues: {
      docName: '',
      filename: ''
    },
    validationSchema: Yup.object({
      docName: Yup.string()
        .trim()
        .min(1, 'must be at least 1 character')
        .max(255, 'must be 255 characters or less')
        .required('name is required'),
      filename: Yup.string()
        .trim()
        .min(1, 'must be at least 1 character')
        .max(255, 'must be 255 characters or less')
        .required('filename is required')
        .test('is-valid-filename', function (value) {
          const isValid = validateName(value);
          return isValid ? true : this.createError({ message: validateNameError(value) });
        })
        .test(
          'not-reserved',
          `The file names "collection" and "folder" are reserved in bruno`,
          (value) => !['collection', 'folder'].includes(value)
        )
    }),
    onSubmit: (values) => {
      dispatch(newDocPage({
        name: values.docName,
        filename: values.filename,
        collectionUid,
        itemUid: item ? item.uid : null,
        docs: defaultDocContent(values.docName)
      }))
        .then(() => {
          toast.success('New doc page created!');
          onClose();
        })
        .catch((err) => toast.error(err ? err.message : 'An error occurred while adding the doc page'));
    }
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const AdvancedOptions = forwardRef((props, ref) => (
    <div ref={ref} className="flex mr-2 text-link cursor-pointer items-center">
      <button className="btn-advanced" type="button">Options</button>
      <IconCaretDown className="caret ml-1" size={14} strokeWidth={2} />
    </div>
  ));

  return (
    <Portal>
      <StyledWrapper>
        <Modal size="md" title="New Doc Page" hideFooter handleCancel={onClose}>
          <form className="bruno-form" onSubmit={formik.handleSubmit}>
            <div>
              <label htmlFor="docName" className="block font-medium">
                Page Name
              </label>
              <input
                id="doc-name"
                type="text"
                name="docName"
                placeholder="Page Name"
                ref={inputRef}
                className="block textbox mt-2 w-full"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                onChange={(e) => {
                  formik.setFieldValue('docName', e.target.value);
                  !isEditing && formik.setFieldValue('filename', sanitizeName(e.target.value));
                }}
                value={formik.values.docName || ''}
                data-testid="doc-page-name"
              />
              {formik.touched.docName && formik.errors.docName ? (
                <div className="text-red-500">{formik.errors.docName}</div>
              ) : null}
            </div>

            {showFilesystemName && (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="filename" className="flex items-center font-medium">
                    File Name <small className="font-normal text-muted ml-1">(on filesystem)</small>
                    <Help width="300">
                      <p>Bruno saves each doc page as a file in your collection's folder.</p>
                    </Help>
                  </label>
                  {isEditing ? (
                    <IconArrowBackUp
                      className="cursor-pointer opacity-50 hover:opacity-80"
                      size={16}
                      strokeWidth={1.5}
                      onClick={() => toggleEditing(false)}
                    />
                  ) : (
                    <IconEdit
                      className="cursor-pointer opacity-50 hover:opacity-80"
                      size={16}
                      strokeWidth={1.5}
                      onClick={() => toggleEditing(true)}
                    />
                  )}
                </div>
                {isEditing ? (
                  <input
                    id="file-name"
                    type="text"
                    name="filename"
                    placeholder="File Name"
                    className="block textbox mt-2 w-full"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    onChange={formik.handleChange}
                    value={formik.values.filename || ''}
                    data-testid="doc-page-file-name"
                  />
                ) : (
                  <PathDisplay baseName={formik.values.filename ? `${formik.values.filename}.${collection.format}` : ''} />
                )}
                {formik.touched.filename && formik.errors.filename ? (
                  <div className="text-red-500">{formik.errors.filename}</div>
                ) : null}
              </div>
            )}

            <div className="flex justify-between items-center mt-8 bruno-modal-footer">
              <div className="flex advanced-options">
                <Dropdown onCreate={onDropdownCreate} icon={<AdvancedOptions />} placement="bottom-start">
                  <div
                    className="dropdown-item"
                    key="show-filesystem-name"
                    onClick={() => {
                      dropdownTippyRef.current.hide();
                      toggleShowFilesystemName(!showFilesystemName);
                    }}
                  >
                    {showFilesystemName ? 'Hide Filesystem Name' : 'Show Filesystem Name'}
                  </div>
                </Dropdown>
              </div>
              <div className="flex justify-end">
                <Button type="button" color="secondary" variant="ghost" onClick={onClose} className="mr-2">
                  Cancel
                </Button>
                <Button type="submit" data-testid="create-new-doc-page-button">
                  Create
                </Button>
              </div>
            </div>
          </form>
        </Modal>
      </StyledWrapper>
    </Portal>
  );
};

export default NewDocPage;
