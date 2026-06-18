-- TIET Library Seat Occupancy System Schema Setup
-- Database: Oracle SQL & PL-SQL

-- Drop existing objects if they exist to allow clean runs
BEGIN
    EXECUTE IMMEDIATE 'DROP TRIGGER scan_log_trg';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    EXECUTE IMMEDIATE 'DROP PROCEDURE allocate_seat_floor';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    EXECUTE IMMEDIATE 'DROP PROCEDURE release_seat';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    EXECUTE IMMEDIATE 'DROP TABLE scan_log CASCADE CONSTRAINTS';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    EXECUTE IMMEDIATE 'DROP TABLE allocation CASCADE CONSTRAINTS';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    EXECUTE IMMEDIATE 'DROP TABLE seat CASCADE CONSTRAINTS';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    EXECUTE IMMEDIATE 'DROP TABLE floor CASCADE CONSTRAINTS';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    EXECUTE IMMEDIATE 'DROP TABLE student CASCADE CONSTRAINTS';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    EXECUTE IMMEDIATE 'DROP SEQUENCE seat_seq';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    EXECUTE IMMEDIATE 'DROP SEQUENCE alloc_seq';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    EXECUTE IMMEDIATE 'DROP SEQUENCE scan_seq';
EXCEPTION WHEN OTHERS THEN NULL; END;
/

-- Create Sequences
CREATE SEQUENCE seat_seq START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE alloc_seq START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE scan_seq START WITH 1 INCREMENT BY 1 NOCACHE;

-- Create Tables
CREATE TABLE student (
    student_id VARCHAR2(20) PRIMARY KEY,
    student_name VARCHAR2(50) NOT NULL,
    course VARCHAR2(30)
);

CREATE TABLE floor (
    floor_id NUMBER PRIMARY KEY,
    floor_name VARCHAR2(20) NOT NULL,
    total_seats NUMBER NOT NULL,
    occupied_seats NUMBER DEFAULT 0,
    priority_order NUMBER NOT NULL,
    status VARCHAR2(10) CHECK (status IN ('OPEN', 'CLOSED'))
);

CREATE TABLE seat (
    seat_id NUMBER PRIMARY KEY,
    floor_id NUMBER REFERENCES floor(floor_id) ON DELETE CASCADE,
    seat_no NUMBER NOT NULL,
    status VARCHAR2(10) DEFAULT 'FREE' CHECK (status IN ('FREE', 'OCCUPIED'))
);

CREATE TABLE allocation (
    allocation_id NUMBER PRIMARY KEY,
    student_id VARCHAR2(20) REFERENCES student(student_id) ON DELETE CASCADE,
    seat_id NUMBER REFERENCES seat(seat_id) ON DELETE CASCADE,
    entry_time TIMESTAMP DEFAULT SYSTIMESTAMP,
    exit_time TIMESTAMP
);

CREATE TABLE scan_log (
    scan_id NUMBER PRIMARY KEY,
    student_id VARCHAR2(20) REFERENCES student(student_id) ON DELETE CASCADE,
    scan_type VARCHAR2(10) CHECK (scan_type IN ('ENTRY', 'EXIT')),
    scan_time TIMESTAMP DEFAULT SYSTIMESTAMP,
    floor_id NUMBER
);

-- Stored Procedures

-- 1. Allocate Seat Procedure
CREATE OR REPLACE PROCEDURE allocate_seat_floor (
    p_student_id IN VARCHAR2,
    p_floor_id IN NUMBER
) AS
    v_student_count NUMBER;
    v_active_alloc NUMBER;
    v_seat_id NUMBER;
    v_seat_no NUMBER;
    v_floor_status VARCHAR2(10);
BEGIN
    -- Validate student exists
    SELECT COUNT(*) INTO v_student_count FROM student WHERE student_id = p_student_id;
    IF v_student_count = 0 THEN
        RAISE_APPLICATION_ERROR(-20001, 'Student STU ID not found.');
    END IF;

    -- Validate floor is open
    SELECT status INTO v_floor_status FROM floor WHERE floor_id = p_floor_id;
    IF v_floor_status = 'CLOSED' THEN
        RAISE_APPLICATION_ERROR(-20005, 'Floor is currently CLOSED.');
    END IF;

    -- Check student not already inside (no active allocation with NULL exit_time)
    SELECT COUNT(*) INTO v_active_alloc 
    FROM allocation 
    WHERE student_id = p_student_id AND exit_time IS NULL;
    
    IF v_active_alloc > 0 THEN
        RAISE_APPLICATION_ERROR(-20002, 'Student already has an active entry.');
    END IF;

    -- Find lowest seat_no FREE seat on the floor
    BEGIN
        SELECT seat_id, seat_no INTO v_seat_id, v_seat_no
        FROM (
            SELECT seat_id, seat_no 
            FROM seat 
            WHERE floor_id = p_floor_id AND status = 'FREE' 
            ORDER BY seat_no ASC
        ) WHERE ROWNUM = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20003, 'No available seats on this floor.');
    END;

    -- Insert allocation record
    INSERT INTO allocation (allocation_id, student_id, seat_id, entry_time, exit_time)
    VALUES (alloc_seq.NEXTVAL, p_student_id, v_seat_id, SYSTIMESTAMP, NULL);

    -- Mark seat OCCUPIED
    UPDATE seat SET status = 'OCCUPIED' WHERE seat_id = v_seat_id;

    -- Increment floor.occupied_seats
    UPDATE floor SET occupied_seats = occupied_seats + 1 WHERE floor_id = p_floor_id;
END;
/

-- 2. Release Seat Procedure
CREATE OR REPLACE PROCEDURE release_seat (
    p_student_id IN VARCHAR2
) AS
    v_student_count NUMBER;
    v_allocation_id NUMBER;
    v_seat_id NUMBER;
    v_floor_id NUMBER;
BEGIN
    -- Validate student exists
    SELECT COUNT(*) INTO v_student_count FROM student WHERE student_id = p_student_id;
    IF v_student_count = 0 THEN
        RAISE_APPLICATION_ERROR(-20001, 'Student STU ID not found.');
    END IF;

    -- Find active allocation (exit_time IS NULL)
    BEGIN
        SELECT a.allocation_id, a.seat_id, s.floor_id 
        INTO v_allocation_id, v_seat_id, v_floor_id
        FROM allocation a
        JOIN seat s ON a.seat_id = s.seat_id
        WHERE a.student_id = p_student_id AND a.exit_time IS NULL;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20004, 'No active library entry found.');
    END;

    -- Set exit_time = SYSTIMESTAMP
    UPDATE allocation 
    SET exit_time = SYSTIMESTAMP 
    WHERE allocation_id = v_allocation_id;

    -- Mark seat FREE
    UPDATE seat SET status = 'FREE' WHERE seat_id = v_seat_id;

    -- Decrement floor.occupied_seats
    UPDATE floor SET occupied_seats = occupied_seats - 1 WHERE floor_id = v_floor_id;
END;
/

-- Database Trigger
CREATE OR REPLACE TRIGGER scan_log_trg
AFTER INSERT ON scan_log
FOR EACH ROW
BEGIN
    IF :NEW.scan_type = 'ENTRY' THEN
        allocate_seat_floor(:NEW.student_id, :NEW.floor_id);
    ELSIF :NEW.scan_type = 'EXIT' THEN
        release_seat(:NEW.student_id);
    END IF;
END;
/

-- Insert Seed Data
-- 1. Students
INSERT INTO student (student_id, student_name, course) VALUES ('STU101', 'Ayush', 'CSE');
INSERT INTO student (student_id, student_name, course) VALUES ('STU102', 'Rahul', 'CSE');
INSERT INTO student (student_id, student_name, course) VALUES ('STU103', 'Tanish', 'CSE');

-- 2. Floors (Ground, First, Second, Third, Fourth)
INSERT INTO floor (floor_id, floor_name, total_seats, occupied_seats, priority_order, status) 
VALUES (1, 'Ground', 200, 0, 1, 'OPEN');
INSERT INTO floor (floor_id, floor_name, total_seats, occupied_seats, priority_order, status) 
VALUES (2, 'First', 200, 0, 2, 'OPEN');
INSERT INTO floor (floor_id, floor_name, total_seats, occupied_seats, priority_order, status) 
VALUES (3, 'Second', 200, 0, 3, 'OPEN');
INSERT INTO floor (floor_id, floor_name, total_seats, occupied_seats, priority_order, status) 
VALUES (4, 'Third', 200, 0, 4, 'OPEN');
INSERT INTO floor (floor_id, floor_name, total_seats, occupied_seats, priority_order, status) 
VALUES (5, 'Fourth', 200, 0, 5, 'OPEN');

-- 3. Nested loop to generate 200 free seats per floor (total 1000 seats)
DECLARE
    v_floor_id NUMBER;
    v_seat_no NUMBER;
BEGIN
    FOR v_floor_id IN 1..5 LOOP
        FOR v_seat_no IN 1..200 LOOP
            INSERT INTO seat (seat_id, floor_id, seat_no, status)
            VALUES (seat_seq.NEXTVAL, v_floor_id, v_seat_no, 'FREE');
        END LOOP;
    END LOOP;
    COMMIT;
END;
/
